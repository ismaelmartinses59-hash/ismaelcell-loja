import { Router, type IRouter } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { db, appConfigTable, caixaTable, caixaSessoesTable, pecasTable } from "@workspace/db";
import { requireFinanceSession } from "./auth";
import { ai } from "@workspace/integrations-gemini-ai";
import { calcularDisponibilidade, mediaDasSemanasComCompra } from "./financeiro-ia-calculos.js";

const router: IRouter = Router();
router.use(requireFinanceSession);

const TZ = "America/Sao_Paulo";
const keys = {
  reserva: "ia_fin_reserva_valor",
  proteger: "ia_fin_reserva_ativa",
  meta: "ia_fin_meta_compra",
};
const categorias = [
  "pecas", "frete", "aluguel", "energia", "internet", "agua",
  "combustivel", "ferramentas", "alimentacao", "retirada pessoal",
  "parcelas", "outros",
] as const;
type Categoria = (typeof categorias)[number];

function cents(value: string | null | undefined): number {
  const clean = String(value ?? "").replace(/[^\d,.-]/g, "");
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".") : clean;
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const reais = (value: number) =>
  (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const money = (value: number) => Math.round(value) / 100;
const daySP = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
function daysAgo(days: number): string {
  return daySP(new Date(Date.now() - days * 86400000));
}
const dayIndex = (date: Date) => {
  const day = daySP(date);
  return Math.floor(Date.parse(`${day}T12:00:00Z`) / 86400000);
};
const inputMoney = (value: unknown): number | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) return null;
  const amount = cents(raw);
  return amount <= 10000000000 ? amount : null;
};
function classificar(categoria: string | null, motivo: string): Categoria | null {
  if (categorias.includes(categoria as Categoria)) return categoria as Categoria;
  // Entradas antigas de nota fiscal possuem um motivo padronizado e inequívoco.
  return /^(compra de peças \(nota do fornecedor\)|compra de estoque:)/i.test(motivo.trim()) ? "pecas" : null;
}

async function readConfig() {
  const rows = await db.select().from(appConfigTable);
  const config = new Map(rows.map(({ key, value }) => [key, value]));
  return {
    rows: config,
    reserva: cents(config.get(keys.reserva) ?? "0"),
    proteger: config.get(keys.proteger) === "true",
    meta: cents(config.get(keys.meta) ?? "0"),
  };
}

async function snapshot() {
  const now = new Date();
  const today = dayIndex(now);
  const todayString = daySP(now);
  const [config, sessoes, recent, pixRows, pecas] = await Promise.all([
    readConfig(),
    db.select().from(caixaSessoesTable).orderBy(desc(caixaSessoesTable.aberturaAt)).limit(1),
    db.select().from(caixaTable).where(gte(caixaTable.createdAt, new Date(Date.now() - 120 * 86400000))),
    db.select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
      .from(caixaTable).where(eq(caixaTable.formaPagamento, "pix")),
    db.select().from(pecasTable),
  ]);
  const produtos = pecas.filter(p => p.setor === "cliente");
  const custoPorId = new Map(pecas.map(p => [p.id, p.valorCusto]));
  const sessao = sessoes[0] ?? null;
  // A gaveta não é a soma histórica: cada abertura/fechamento faz um novo balanço físico.
  const dataBase = sessao?.fechamentoAt ?? sessao?.aberturaAt ?? null;
  const saldoBase = sessao?.fechamentoAt
    ? cents(sessao.valorContado ?? sessao.valorFinal ?? sessao.valorInicial)
    : cents(sessao?.valorInicial);
  const movimentosGaveta = dataBase
    ? await db.select().from(caixaTable).where(gte(caixaTable.createdAt, dataBase))
    : [];
  const dinheiro = dataBase
    ? saldoBase + movimentosGaveta.reduce((sum, row) => {
      if (row.formaPagamento && row.formaPagamento !== "dinheiro") return sum;
      return sum + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor);
    }, 0) : null;
  const pix = pixRows.reduce((sum, row) =>
    sum + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor), 0);
  const saldos = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, 0, 0);
  const total = saldos.total;
  const disponivel = saldos.disponivel;

  const weekStart = today - ((new Date(`${todayString}T12:00:00Z`).getUTCDay() + 6) % 7);
  const totalPeriod = (min: number, max: number) => {
    const rows = recent.filter(row => {
      const day = dayIndex(row.createdAt);
      return day >= min && day <= max;
    });
    let entradas = 0, saidas = 0, retiradas = 0, compras = 0, custo = 0, custoAusente = false;
    const categoriasTotais: Record<string, number> = {};
    const vendasCusto = new Set<number>();
    for (const row of rows) {
      const amount = cents(row.valor);
      if (row.tipo === "entrada") {
        entradas += amount;
        if (row.pecaId && (!row.vendaId || !vendasCusto.has(row.vendaId))) {
          if (row.vendaId) vendasCusto.add(row.vendaId);
          const custoPeca = custoPorId.get(row.pecaId);
          if (custoPeca && cents(custoPeca) > 0) custo += cents(custoPeca);
          else custoAusente = true;
        }
      } else {
        saidas += amount;
        const categoria = classificar(row.categoria, row.motivo);
        if (categoria) categoriasTotais[categoria] = (categoriasTotais[categoria] ?? 0) + amount;
        if (categoria === "retirada pessoal") retiradas += amount;
        if (categoria === "pecas") compras += amount;
      }
    }
    // Compra de mercadoria é caixa, mas o custo da peça vendida já integra o lucro
    // estimado; retirar ambos aqui duplicaria o custo.
    const outrasSaidas = saidas - compras - retiradas;
    return {
      entradas, saidas, retiradas, compras, custo,
      lucro: custoAusente ? null : entradas - custo - outrasSaidas,
      categorias: categoriasTotais, registros: rows.length,
      custoAusente,
    };
  };
  const week = totalPeriod(weekStart, today);
  const dia = totalPeriod(today, today);
  const previousWeek = totalPeriod(weekStart - 7, weekStart - 1);
  const month = totalPeriod(today - 29, today);
  const previousMonth = totalPeriod(today - 59, today - 30);
  const purchaseRows = recent.filter(row => row.tipo === "saida" &&
    classificar(row.categoria, row.motivo) === "pecas" &&
    dayIndex(row.createdAt) >= today - 56);
  const byWeek = new Map<number, number>();
  const byDay = new Map<number, number>();
  for (const row of purchaseRows) {
    const date = dayIndex(row.createdAt);
    const weekday = new Date(date * 86400000 + 43200000).getUTCDay();
    const monday = date - ((weekday + 6) % 7);
    byWeek.set(monday, (byWeek.get(monday) ?? 0) + cents(row.valor));
    byDay.set(weekday, (byDay.get(weekday) ?? 0) + 1);
  }
  const purchaseValues = [...byWeek.values()];
  const purchaseAverage = mediaDasSemanasComCompra(purchaseValues);
  const commonDay = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const preferredDay = commonDay && commonDay[1] >= 3 ? commonDay[0] : null;
  const stockLow = produtos.filter(p => p.quantidade <= 2)
    .map(p => ({ id: p.id, modelo: p.modelo, quantidade: p.quantidade })).slice(0, 8);
  // Gastos futuros configurados no módulo Financeiro: não são saídas realizadas.
  const expenses: { nome: string; valor: number; vencimento: string }[] = [];
  for (const name of ["aluguel", "energia", "internet", "agua"]) {
    const amount = cents(config.rows.get(`fin_custo_${name}`));
    const due = Number(config.rows.get(`fin_dia_${name}`) ?? "7");
    const paid = config.rows.get(`fin_pago_${name}`);
    for (let offset = 0; offset <= 7; offset++) {
      const date = new Date((today + offset) * 86400000 + 43200000);
      const dateString = date.toISOString().slice(0, 10);
      if (amount > 0 && date.getUTCDate() === due && paid?.slice(0, 7) !== dateString.slice(0, 7))
        expenses.push({ nome: name, valor: amount, vencimento: dateString });
    }
  }
  try {
    const extras = JSON.parse(config.rows.get("fin_contas_extras") ?? "[]") as
      { nome?: string; valor?: string; diaVencimento?: number; pagoEm?: string }[];
    if (Array.isArray(extras)) for (const extra of extras) {
      for (let offset = 0; offset <= 7; offset++) {
        const date = new Date((today + offset) * 86400000 + 43200000);
        const dateString = date.toISOString().slice(0, 10);
        if (date.getUTCDate() === extra.diaVencimento &&
          extra.pagoEm?.slice(0, 7) !== dateString.slice(0, 7) && cents(extra.valor) > 0)
          expenses.push({ nome: extra.nome ?? "Conta", valor: cents(extra.valor), vencimento: dateString });
      }
    }
  } catch { /* configuração legada inválida: não inventar vencimentos */ }
  const expensesTotal = expenses.reduce((sum, e) => sum + e.valor, 0);
  const spending = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, expensesTotal, config.meta);
  const safeToSpend = spending.podeGastar;
  const recentDays = totalPeriod(today - 27, today);
  const distinctDays = new Set(recent.filter(row => dayIndex(row.createdAt) >= today - 27)
    .map(row => daySP(row.createdAt))).size;
  const projected = total === null || distinctDays < 7 ? null
    : total + Math.round((recentDays.entradas - recentDays.saidas) / 28 * 7);
  const alerts: { nivel: "risco" | "atencao" | "positivo"; titulo: string; texto: string }[] = [];
  if (disponivel !== null && purchaseAverage !== null && disponivel < purchaseAverage)
    alerts.push({ nivel: "risco", titulo: "Compra de estoque", texto: `Disponível: ${reais(disponivel)}; média das semanas com compras registradas: ${reais(purchaseAverage)}. Faltam ${reais(purchaseAverage - disponivel)} sem usar a reserva.` });
  if (total !== null && config.proteger && total < config.reserva)
    alerts.push({ nivel: "risco", titulo: "Reserva abaixo da meta", texto: `Saldo registrado: ${reais(total)}; meta protegida: ${reais(config.reserva)}.` });
  if (previousWeek.saidas > 0 && week.saidas > previousWeek.saidas * 1.25)
    alerts.push({ nivel: "atencao", titulo: "Saídas acima da semana anterior", texto: `Esta semana: ${reais(week.saidas)}; semana anterior inteira: ${reais(previousWeek.saidas)}.` });
  if (disponivel !== null && week.retiradas > 0 && week.retiradas > disponivel / 4)
    alerts.push({ nivel: "atencao", titulo: "Retiradas relevantes", texto: `As retiradas registradas nesta semana somam ${reais(week.retiradas)}; disponível atual: ${reais(disponivel)}.` });
  if (expensesTotal > 0 && disponivel !== null && expensesTotal > disponivel)
    alerts.push({ nivel: "risco", titulo: "Contas próximas", texto: `Contas previstas para os próximos 7 dias: ${reais(expensesTotal)}; disponível: ${reais(disponivel)}.` });
  if (stockLow.length)
    alerts.push({ nivel: "atencao", titulo: "Estoque baixo", texto: `${stockLow.length} produto(s) com no máximo 2 unidades cadastradas.` });
  if (previousWeek.entradas > 0 && week.entradas > previousWeek.entradas)
    alerts.push({ nivel: "positivo", titulo: "Faturamento em alta", texto: `Esta semana: ${reais(week.entradas)}; semana anterior: ${reais(previousWeek.entradas)}. A semana atual ainda está em andamento.` });
  if (!alerts.length) alerts.push({ nivel: "atencao", titulo: "Dados registrados", texto: "Sem alertas confiáveis por enquanto. Registre compras e categorias para melhorar a análise." });
  const situacao = alerts.some(a => a.nivel === "risco") ? "risco" :
    alerts.some(a => a.nivel === "atencao") ? "atencao" : "saudavel";
  return {
    atualizadoEm: now.toISOString(),
    saldos: {
      dinheiro: dinheiro === null ? null : money(dinheiro),
      pix: money(pix), total: total === null ? null : money(total),
      reserva: money(config.reserva), protecaoAtiva: config.proteger,
      disponivel: disponivel === null ? null : money(disponivel),
      podeGastar: safeToSpend === null ? null : money(safeToSpend),
      base: sessao ? `Dinheiro: ${sessao.status === "aberto" ? "abertura" : "último fechamento"} da gaveta e movimentos posteriores. PIX: saldo líquido dos lançamentos registrados desde o início; transferências fora do sistema não estão incluídas.` : "Sem sessão do Caixa registrada: saldo físico e disponibilidade não calculáveis.",
    },
    metaCompra: money(config.meta),
    faltamMeta: spending.faltaMeta === null ? null : money(spending.faltaMeta),
    dia: { entradas: money(dia.entradas), saidas: money(dia.saidas), retiradas: money(dia.retiradas) },
    semana: {
      entradas: money(week.entradas), saidas: money(week.saidas),
      retiradas: money(week.retiradas), compras: money(week.compras),
      custo: money(week.custo), lucro: week.lucro === null ? null : money(week.lucro),
      registros: week.registros, custoAusente: week.custoAusente,
    },
    mes: { entradas: money(month.entradas), saidas: money(month.saidas), lucro: month.lucro === null ? null : money(month.lucro) },
    comparacao: { semanaAnterior: { entradas: money(previousWeek.entradas), saidas: money(previousWeek.saidas) }, periodoAnterior: { entradas: money(previousMonth.entradas), saidas: money(previousMonth.saidas) } },
    compras: {
      totalSemana: money(week.compras), mediaSemanal: purchaseAverage === null ? null : money(purchaseAverage),
      menor: purchaseValues.length ? money(Math.min(...purchaseValues)) : null,
      maior: purchaseValues.length ? money(Math.max(...purchaseValues)) : null,
      tendencia: purchaseValues.length < 2 ? null : money(purchaseValues.at(-1)! - purchaseValues.at(-2)!),
      diaHabitual: preferredDay,
      semanasRegistradas: purchaseValues.length,
    },
    categorias: Object.fromEntries(Object.entries(week.categorias).map(([key, v]) => [key, money(v)])),
    estoqueBaixo: stockLow,
    despesasPrevistas: { total: money(expensesTotal), contas: expenses.map(e => ({ ...e, valor: money(e.valor) })) },
    projecao7Dias: projected === null ? null : money(projected),
    situacao, observacoes: alerts.slice(0, 5),
    avisos: [
      "Disponível = dinheiro físico apurado + PIX registrado − reserva protegida. Cartão não é dinheiro disponível.",
      "Lucro estimado depende dos custos das peças cadastrados; não inclui custos de serviços não registrados.",
      "Compras semanais consideram apenas semanas com compras de peças identificáveis no Caixa.",
      "Projeção baseada nos últimos 28 dias, não é garantia de saldo futuro.",
    ],
  };
}

router.get("/financeiro-ia", async (_req, res) => {
  try { res.json(await snapshot()); }
  catch (err) { _req.log.error({ err }, "financeiro-ia"); res.status(500).json({ error: "Não foi possível analisar o Caixa." }); }
});

router.put("/financeiro-ia/config", async (req, res) => {
  const reserva = inputMoney(req.body?.reserva);
  const meta = inputMoney(req.body?.metaCompra);
  const proteger = req.body?.protecaoAtiva;
  if (reserva === null || meta === null || typeof proteger !== "boolean") {
    res.status(400).json({ error: "Informe reserva, meta e proteção válidas." }); return;
  }
  try {
    await db.transaction(async tx => {
      for (const [key, value] of [
        [keys.reserva, (reserva / 100).toFixed(2)],
        [keys.meta, (meta / 100).toFixed(2)],
        [keys.proteger, String(proteger)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    });
    res.json(await snapshot());
  } catch (err) { req.log.error({ err }, "financeiro-ia/config"); res.status(500).json({ error: "Não foi possível salvar a configuração." }); }
});

router.post("/financeiro-ia/retiradas", async (req, res) => {
  const amount = inputMoney(req.body?.valor);
  const motivo = String(req.body?.motivo ?? "").trim().slice(0, 120);
  const observacao = String(req.body?.observacao ?? "").trim().slice(0, 500);
  const date = String(req.body?.data ?? "");
  const forma = req.body?.formaPagamento;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
  const validDate = parsedDate !== null && Number.isFinite(parsedDate.getTime()) &&
    parsedDate.toISOString().slice(0, 10) === date;
  if (!amount || !motivo || !validDate ||
    dayIndex(new Date(`${date}T12:00:00Z`)) > dayIndex(new Date()) ||
    (forma !== "dinheiro" && forma !== "pix")) {
    res.status(400).json({ error: "Informe valor positivo, motivo, data válida e dinheiro ou PIX." }); return;
  }
  try {
    const [row] = await db.insert(caixaTable).values({
      tipo: "saida", valor: (amount / 100).toFixed(2).replace(".", ","),
      motivo, observacao, categoria: "retirada pessoal", formaPagamento: forma,
      createdAt: new Date(`${date}T15:00:00Z`),
    }).returning();
    res.status(201).json({ id: row.id, resumo: await snapshot() });
  } catch (err) { req.log.error({ err }, "financeiro-ia/retiradas"); res.status(500).json({ error: "Não foi possível registrar a retirada." }); }
});

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
const insufficient = "Não tenho dados suficientes registrados no Caixa para calcular isso.";
router.post("/financeiro-ia/perguntar", async (req, res) => {
  const question = String(req.body?.pergunta ?? "").trim();
  if (!question || question.length > 400) {
    res.status(400).json({ error: "Escreva uma pergunta de até 400 caracteres." }); return;
  }
  try {
    const s = await snapshot();
    const q = normalize(question);
    const saldo = s.saldos;
    let answer: string | null = null;
    const amount = question.match(/(?:r\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)/i);
    const target = amount ? inputMoney(amount[1].replace(/\./g, "")) : null;
    if (/posso comprar|comprar.*peca|comprar.*estoque/.test(q)) {
      answer = saldo.disponivel === null ? insufficient : target === null
        ? `Disponível sem usar a reserva: ${reais(Math.round(saldo.disponivel * 100))}. Informe o valor da compra para comparar.`
        : `Compra consultada: ${reais(target)}. Disponível sem usar a reserva: ${reais(Math.round(saldo.disponivel * 100))}. ${target <= Math.round(saldo.disponivel * 100) ? "Cabe no caixa operacional registrado." : `Faltam ${reais(target - Math.round(saldo.disponivel * 100))}; isso utilizaria a reserva ou exigiria novas entradas. Nenhum valor será movimentado automaticamente.`}`;
    } else if (/quanto.*(gastar|retirar|separar para mim)/.test(q)) {
      answer = saldo.podeGastar === null ? insufficient
        : `Limite conservador registrado: ${reais(Math.round(saldo.podeGastar * 100))}. Cálculo: ${reais(Math.round(saldo.disponivel! * 100))} disponível − ${reais(Math.round(s.despesasPrevistas.total * 100))} em contas previstas nos próximos 7 dias − ${reais(Math.round(s.metaCompra * 100))} da meta de compra. Não inclui despesas não cadastradas.`;
    } else if (/reserva|disponivel|caixa/.test(q)) {
      answer = saldo.total === null ? insufficient
        : `Dinheiro físico: ${reais(Math.round(saldo.dinheiro! * 100))}; PIX líquido registrado: ${reais(Math.round(saldo.pix * 100))}; total: ${reais(Math.round(saldo.total * 100))}; reserva ${saldo.protecaoAtiva ? "protegida" : "desativada"}: ${reais(Math.round(saldo.reserva * 100))}; disponível sem usar reserva: ${reais(Math.round(saldo.disponivel! * 100))}. ${saldo.base}`;
    } else if (/maior despesa|gasto.*mais|gastando demais/.test(q)) {
      const categories = Object.entries(s.categorias).sort((a, b) => b[1] - a[1]);
      answer = categories.length ? `Nesta semana, a maior categoria registrada foi ${categories[0][0]}: ${reais(Math.round(categories[0][1] * 100))}. Saídas da semana: ${reais(Math.round(s.semana.saidas * 100))}; semana anterior: ${reais(Math.round(s.comparacao.semanaAnterior.saidas * 100))}. Despesas antigas sem categoria não entram na classificação.`
        : insufficient;
    } else if (/fatur|melhorando|evolu/.test(q)) {
      answer = s.semana.registros ? `Entradas nesta semana: ${reais(Math.round(s.semana.entradas * 100))}; semana anterior: ${reais(Math.round(s.comparacao.semanaAnterior.entradas * 100))}. Nos últimos 30 dias: ${reais(Math.round(s.mes.entradas * 100))}; 30 dias anteriores: ${reais(Math.round(s.comparacao.periodoAnterior.entradas * 100))}. A semana atual está em andamento; faturamento sozinho não mede lucro.`
        : insufficient;
    } else if (/lucro/.test(q)) {
      answer = s.semana.lucro === null ? insufficient
        : `Lucro estimado da semana: ${reais(Math.round(s.semana.lucro * 100))}. Entradas ${reais(Math.round(s.semana.entradas * 100))} menos custo das peças vendidas e despesas operacionais registradas; compras de estoque e retiradas não são descontadas duas vezes. Custos de serviços não registrados não entram.`;
    } else if (/peca|estoque|compra/.test(q)) {
      answer = s.compras.mediaSemanal === null ? insufficient
        : `Compras de peças nesta semana: ${reais(Math.round(s.compras.totalSemana * 100))}. Média: ${reais(Math.round(s.compras.mediaSemanal * 100))} por semana com compras registradas (${s.compras.semanasRegistradas} semana(s)). ${s.estoqueBaixo.length} produto(s) com estoque baixo.`;
    } else if (/proxim|previs|futuro/.test(q)) {
      answer = s.projecao7Dias === null ? insufficient
        : `Estimativa para os próximos 7 dias: ${reais(Math.round(s.projecao7Dias * 100))}, baseada na média diária dos últimos 28 dias registrados. Contas previstas até lá: ${reais(Math.round(s.despesasPrevistas.total * 100))}. É uma projeção, não uma garantia.`;
    }
    // Opcional no host externo: sem integração configurada, não há resposta
    // generativa que possa inventar números. As respostas essenciais acima funcionam.
    if (!answer && process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      const facts = JSON.stringify({
        saldos: s.saldos, semana: s.semana, mes: s.mes, comparacao: s.comparacao,
        compras: s.compras, despesasPrevistas: s.despesasPrevistas,
        estoqueBaixo: s.estoqueBaixo, avisos: s.avisos,
      });
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Você é um assistente financeiro de uma loja. Responda em português usando SOMENTE os fatos JSON a seguir; se a pergunta exigir dados ausentes, diga exatamente "${insufficient}". Nunca proponha ações automáticas, nunca invente valores. Fatos: ${facts}. Pergunta: ${question}`,
        });
        answer = response.text?.trim() || insufficient;
      } catch (err) {
        req.log.warn({ err }, "financeiro-ia modelo indisponível");
        answer = insufficient;
      }
    }
    res.json({ resposta: answer ?? insufficient, atualizadoEm: s.atualizadoEm });
  } catch (err) {
    req.log.error({ err }, "financeiro-ia/perguntar");
    res.status(500).json({ error: "Não foi possível analisar os dados neste momento." });
  }
});

export default router;