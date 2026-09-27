import { Router, type IRouter } from "express";
import { and, desc, eq, gt, gte, sql } from "drizzle-orm";
import { db, appConfigTable, caixaTable, caixaSessoesTable, pecasTable } from "@workspace/db";
import { requireFinanceSession } from "./auth";
import { ai } from "@workspace/integrations-gemini-ai";
import { calcularDisponibilidade, calcularReservaGradual, mediaDasSemanasComCompra, percentualReserva, somarEntradasNovas } from "./financeiro-ia-calculos.js";

const router: IRouter = Router();
router.use(requireFinanceSession);
const voiceRequests = new Map<string, { count: number; resetAt: number }>();

const TZ = "America/Sao_Paulo";
const keys = {
  reserva: "ia_fin_reserva_valor",
  proteger: "ia_fin_reserva_ativa",
  meta: "ia_fin_meta_compra",
  metaReserva: "ia_fin_meta_reserva",
  ultimoLancamentoReserva: "ia_fin_reserva_ultimo_lancamento",
};
const META_RESERVA_PADRAO = 150000;
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
    proteger: config.get(keys.proteger) !== "false",
    meta: cents(config.get(keys.meta) ?? "0"),
    metaReserva: cents(config.get(keys.metaReserva) ?? "1500"),
  };
}

async function atualizarReservaGradual(
  total: number | null,
  reserva: number,
  metaReserva: number,
  compraPlanejada: number,
  contasPrevistas: number,
  percentual: number,
) {
  if (total === null) {
    const aposContas = Math.max(0, (total ?? 0) - contasPrevistas);
    const pedidosPreservados = Math.min(compraPlanejada, Math.ceil(aposContas * (100 - percentual) / 100));
    return { reserva, metaReserva, aporte: 0, entradaNova: 0, inicioAgora: false, compraPlanejada: Math.min(pedidosPreservados, Math.max(0, aposContas - reserva)), protecaoAtiva: null as boolean | null, saldosAtuais: null as { dinheiro: number; pix: number } | null };
  }
  return db.transaction(async tx => {
    // Avança o marcador e a reserva juntos: repetir a consulta não duplica o aporte.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
    const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
    const atual = cents(config.get(keys.reserva) ?? "0");
    const teto = cents(config.get(keys.metaReserva) ?? String(META_RESERVA_PADRAO / 100));
    const ativa = config.get(keys.proteger) !== "false";
    const compra = Math.max(compraPlanejada, cents(config.get(keys.meta) ?? "0"));
    const marcador = config.get(keys.ultimoLancamentoReserva);
    if (marcador === undefined) {
      // Ao ativar o rastreamento, não reaproveita entradas antigas como se
      // tivessem acabado de ser recebidas.
      const [ultimo] = await tx.select({ id: caixaTable.id }).from(caixaTable).orderBy(desc(caixaTable.id)).limit(1);
      await tx.insert(appConfigTable).values({ key: keys.ultimoLancamentoReserva, value: String(ultimo?.id ?? 0) })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value: String(ultimo?.id ?? 0), updatedAt: new Date() } });
      const aposContas = Math.max(0, total - contasPrevistas);
      const pedidos = Math.min(compra, Math.ceil(aposContas * (100 - percentual) / 100));
      return { reserva: atual, metaReserva: teto, aporte: 0, entradaNova: 0, inicioAgora: true, compraPlanejada: Math.min(pedidos, Math.max(0, aposContas - atual)), protecaoAtiva: ativa, saldosAtuais: null as { dinheiro: number; pix: number } | null };
    }
    const cursor = Number(marcador);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Marcador da reserva inválido");
    const novos = await tx.select({
      id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor, formaPagamento: caixaTable.formaPagamento,
    }).from(caixaTable).where(gt(caixaTable.id, cursor)).orderBy(caixaTable.id);
    const entradaNova = somarEntradasNovas(
      novos.map(row => ({ ...row, valorCentavos: cents(row.valor) })), cursor,
    );
    let dinheiroAtual: number | null = null;
    let pixAtual = 0;
    let novo = atual;
    if (entradaNova > 0 && ativa) {
      // Consulta o saldo depois de ver a entrada confirmada no Caixa.
      const [sessao] = await tx.select().from(caixaSessoesTable).orderBy(desc(caixaSessoesTable.aberturaAt)).limit(1);
      const dataBase = sessao?.fechamentoAt ?? sessao?.aberturaAt ?? null;
      if (dataBase) {
        const saldoBase = sessao.fechamentoAt
          ? cents(sessao.valorContado ?? sessao.valorFinal ?? sessao.valorInicial)
          : cents(sessao.valorInicial);
        const movimentos = await tx.select().from(caixaTable).where(gte(caixaTable.createdAt, dataBase));
        dinheiroAtual = saldoBase + movimentos.reduce((soma, row) => {
          if (row.formaPagamento && row.formaPagamento !== "dinheiro") return soma;
          return soma + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor);
        }, 0);
        const pixRegistrados = await tx.select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
          .from(caixaTable).where(eq(caixaTable.formaPagamento, "pix"));
        pixAtual = pixRegistrados.reduce((soma, row) =>
          soma + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor), 0);
        novo = calcularReservaGradual(
          dinheiroAtual + pixAtual, atual, teto, contasPrevistas, compra, percentual, entradaNova,
        );
      }
    }
    const aposContas = Math.max(0, (dinheiroAtual === null ? total : dinheiroAtual + pixAtual) - contasPrevistas);
    const pedidosPreservados = Math.min(compra, Math.ceil(aposContas * (100 - percentual) / 100));
    if (novo > atual) {
      await tx.insert(appConfigTable).values({ key: keys.reserva, value: (novo / 100).toFixed(2) })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: (novo / 100).toFixed(2), updatedAt: new Date() },
        });
    }
    // Sem base física, não consome a entrada; tenta novamente após abrir a gaveta.
    if (novos.length && (entradaNova === 0 || !ativa || dinheiroAtual !== null)) {
      await tx.insert(appConfigTable).values({ key: keys.ultimoLancamentoReserva, value: String(novos.at(-1)!.id) })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: String(novos.at(-1)!.id), updatedAt: new Date() },
        });
    }
    return {
      reserva: novo, metaReserva: teto, aporte: novo - atual,
      entradaNova: dinheiroAtual === null ? 0 : entradaNova, inicioAgora: false,
      compraPlanejada: Math.min(pedidosPreservados, Math.max(0, aposContas - novo)),
      protecaoAtiva: ativa,
      saldosAtuais: dinheiroAtual === null ? null : { dinheiro: dinheiroAtual, pix: pixAtual },
    };
  });
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
  let dinheiro = dataBase
    ? saldoBase + movimentosGaveta.reduce((sum, row) => {
      if (row.formaPagamento && row.formaPagamento !== "dinheiro") return sum;
      return sum + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor);
    }, 0) : null;
  let pix = pixRows.reduce((sum, row) =>
    sum + (row.tipo === "entrada" ? 1 : -1) * cents(row.valor), 0);
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
  const biggestExpense = recent.filter(row => row.tipo === "saida")
    .sort((a, b) => cents(b.valor) - cents(a.valor))[0];
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
  const entradasLiquidas = (min: number, max: number) =>
    recent.filter(row => {
      const date = dayIndex(row.createdAt);
      return date >= min && date <= max && row.tipo === "entrada" &&
        (!row.formaPagamento || row.formaPagamento === "dinheiro" || row.formaPagamento === "pix");
    }).reduce((sum, row) => sum + cents(row.valor), 0);
  const entradas7Dias = entradasLiquidas(today - 6, today);
  const periodosAnteriores = [1, 2, 3, 4].map(i => {
    const min = today - 6 - i * 7, max = today - i * 7;
    return {
      entradas: entradasLiquidas(min, max),
      comRegistros: recent.some(row => {
        const date = dayIndex(row.createdAt);
        return date >= min && date <= max;
      }),
    };
  });
  const mediaEntradas = periodosAnteriores.every(periodo => periodo.comRegistros)
    ? Math.round(periodosAnteriores.reduce((sum, periodo) => sum + periodo.entradas, 0) / 4)
    : null;
  const taxaReserva = percentualReserva(entradas7Dias, mediaEntradas);
  const reservaAutomatica = await atualizarReservaGradual(
    dinheiro === null ? null : dinheiro + pix, config.reserva, config.metaReserva,
    config.meta > 0 ? config.meta : purchaseAverage ?? 0,
    expensesTotal, taxaReserva,
  );
  if (reservaAutomatica.saldosAtuais) {
    dinheiro = reservaAutomatica.saldosAtuais.dinheiro;
    pix = reservaAutomatica.saldosAtuais.pix;
  }
  const total = dinheiro === null ? null : dinheiro + pix;
  config.reserva = reservaAutomatica.reserva;
  config.metaReserva = reservaAutomatica.metaReserva;
  if (reservaAutomatica.protecaoAtiva !== null) config.proteger = reservaAutomatica.protecaoAtiva;
  const saldos = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, 0, 0);
  const disponivel = saldos.disponivel;
  const spending = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, expensesTotal, config.meta);
  const safeToSpend = spending.podeGastar;
  const recentDays = totalPeriod(today - 27, today);
  const distinctDays = new Set(recent.filter(row => dayIndex(row.createdAt) >= today - 27)
    .map(row => daySP(row.createdAt))).size;
  const projected = total === null || distinctDays < 7 ? null
    : total + Math.round((recentDays.entradas - recentDays.saidas) / 28 * 7);
  type Alerta = { nivel: "risco" | "atencao" | "positivo"; titulo: string; aconteceu: string; dado: string; impacto: string; continuidade: string; sugestao: string; texto: string };
  const alerts: Alerta[] = [];
  const add = (nivel: Alerta["nivel"], titulo: string, aconteceu: string, dado: string, impacto: string, continuidade: string, sugestao: string) => {
    alerts.push({ nivel, titulo, aconteceu, dado, impacto, continuidade, sugestao, texto: [aconteceu, dado, impacto, continuidade, sugestao].join(" ") });
  };
  const last7 = totalPeriod(today - 6, today);
  const previous4 = [1, 2, 3, 4].map(i => totalPeriod(today - 6 - i * 7, today - i * 7));
  const validComparison = previous4.every(period => period.registros > 0);
  const average = (key: "entradas" | "saidas" | "compras") => validComparison
    ? Math.round(previous4.reduce((sum, period) => sum + period[key], 0) / 4) : null;
  const avgExpenses = average("saidas");
  const avgPurchases = average("compras");
  const avgRevenue = average("entradas");
  const delta = (current: number, base: number | null) => base && base > 0 ? Math.round((current - base) / base * 100) : null;
  const expensesChange = delta(last7.saidas, avgExpenses);
  const purchaseChange = delta(last7.compras, avgPurchases);
  const revenueChange = delta(last7.entradas, avgRevenue);
  const impactCash = (amount: number) => disponivel === null
    ? `Saídas registradas de ${reais(amount)} afetam o fluxo; sem sessão da gaveta não calculo a disponibilidade atual.`
    : `Saídas registradas de ${reais(amount)} reduzem o fluxo; o disponível atual, após outros movimentos e a reserva, é ${reais(disponivel)}.`;
  if (disponivel !== null && purchaseAverage !== null && purchaseValues.length >= 2 && disponivel < purchaseAverage) {
    const gap = purchaseAverage - disponivel;
    add("risco", "Compra de estoque acima do disponível",
      "O caixa operacional registrado está abaixo da média de compra de estoque.",
      `Disponível: ${reais(disponivel)}; média de ${purchaseValues.length} semana(s) com compras registradas: ${reais(purchaseAverage)}; diferença: ${reais(gap)}.`,
      `Uma compra dessa média hoje ultrapassaria o disponível em ${reais(gap)}, sem considerar contas ainda não pagas.`,
      "Se a compra ocorrer antes de novas entradas, pode ser necessário adiar parte dela ou comprometer a reserva protegida.",
      "Confira quais peças são necessárias e considere ajustar o valor ou esperar novas entradas; a decisão é sua.");
  }
  if (total !== null && config.proteger && total < config.reserva) {
    add("risco", "Reserva abaixo da meta",
      "O saldo registrado está abaixo do valor configurado para proteção.",
      `Saldo registrado em dinheiro e PIX: ${reais(total)}; reserva configurada: ${reais(config.reserva)}; diferença: ${reais(config.reserva - total)}.`,
      "Não há valor operacional livre calculado sem usar a meta protegida.",
      "Se novas saídas ocorrerem antes de entradas, a distância até a meta de reserva poderá aumentar.",
      "Considere revisar saídas programadas e acompanhar as próximas entradas antes de assumir novos gastos.");
  }
  if (purchaseChange !== null && purchaseChange > 25 && avgPurchases !== null && avgPurchases > 0) {
    add("atencao", "Compras de peças acima da média",
      "As compras de peças registradas nos últimos 7 dias superaram a média recente.",
      `Compras: ${reais(last7.compras)}; média semanal das quatro semanas anteriores: ${reais(avgPurchases)}; variação: +${purchaseChange}%. ${revenueChange === null ? "Não há base comparável de entradas." : `Entradas registradas: ${reais(last7.entradas)} contra média de ${reais(avgRevenue!)} (${revenueChange >= 0 ? "+" : ""}${revenueChange}%).`}`,
      impactCash(last7.compras),
      "Se as compras mantiverem esse ritmo sem entradas suficientes, haverá menos recursos livres para outras operações.",
      "Antes da próxima compra, confira as peças de maior saída e considere priorizar as necessárias.");
  } else if (expensesChange !== null && expensesChange > 25 && avgExpenses !== null && avgExpenses > 0) {
    add("atencao", "Saídas acima da média registrada",
      "As saídas dos últimos 7 dias superaram a média recente.",
      `Saídas: ${reais(last7.saidas)}; média semanal das quatro semanas anteriores: ${reais(avgExpenses)}; variação: +${expensesChange}%.`,
      impactCash(last7.saidas),
      "Se as saídas continuarem acima da média sem entradas equivalentes, o disponível poderá diminuir.",
      "Considere revisar as categorias de saída e as contas próximas antes de planejar novos gastos.");
  }
  if (disponivel !== null && last7.retiradas > 0 && last7.retiradas > disponivel / 4) {
    add("atencao", "Retiradas e disponibilidade",
      "Houve retiradas registradas nos últimos 7 dias.",
      `Retiradas: ${reais(last7.retiradas)}; disponível atual: ${reais(disponivel)}.`,
      `Essas saídas reduziram o fluxo em ${reais(last7.retiradas)}; o disponível atual já considera os movimentos registrados.`,
      "Se retiradas semelhantes ocorrerem sem novas entradas, a margem para despesas e compras poderá diminuir.",
      "Considere comparar a próxima retirada com as contas previstas e a meta de compra antes de confirmá-la.");
  }
  if (expensesTotal > 0 && disponivel !== null && expensesTotal > disponivel) {
    add("risco", "Contas previstas acima do disponível",
      "O total das contas cadastradas para os próximos 7 dias supera o disponível registrado.",
      `Contas previstas: ${reais(expensesTotal)}; disponível: ${reais(disponivel)}; diferença: ${reais(expensesTotal - disponivel)}.`,
      "Essas contas ainda não foram debitadas; se fossem pagas agora sem novas entradas, ultrapassariam o disponível.",
      "Se nenhum recebimento ocorrer até os vencimentos, poderá faltar saldo operacional para pagá-las sem usar a reserva.",
      "Confira vencimentos e recebimentos esperados antes de programar novas compras.");
  }
  if (stockLow.length) {
    add("atencao", "Estoque com poucas unidades",
      "Há produtos com no máximo duas unidades cadastradas; este é um critério de atenção, não um estoque mínimo configurado.",
      `Itens encontrados: ${stockLow.slice(0, 3).map(p => `${p.modelo} (${p.quantidade})`).join(", ")}${stockLow.length > 3 ? ` e mais ${stockLow.length - 3}` : ""}.`,
      "Estoque baixo não altera o caixa por si só; não há dado suficiente para calcular eventual perda de vendas.",
      "Se houver procura por esses itens e eles acabarem, atendimentos poderão ser adiados.",
      "Confira a procura registrada e considere priorizar os itens necessários na próxima compra.");
  }
  if (avgRevenue !== null && avgRevenue > 0 && revenueChange !== null && revenueChange > 25) {
    add("positivo", "Entradas acima da média",
      "As entradas registradas nos últimos 7 dias superaram a média recente.",
      `Entradas: ${reais(last7.entradas)}; média semanal das quatro semanas anteriores: ${reais(avgRevenue)}; variação: +${revenueChange}%.`,
      "Entradas em dinheiro/PIX podem ampliar o disponível, mas vendas em cartão não são disponibilidade imediata.",
      "O resultado da próxima semana pode ser diferente; as saídas também influenciam o saldo.",
      "Considere acompanhar entradas recebidas e saídas antes de decidir o valor da próxima compra.");
  }
  const situacao = alerts.some(a => a.nivel === "risco") ? "risco" :
    alerts.some(a => a.nivel === "atencao") ? "atencao" :
    alerts.some(a => a.nivel === "positivo") ? "saudavel" : recent.length === 0 ? "sem_dados" : "sem_alertas";
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
    reservaAutomatica: {
      meta: money(config.metaReserva),
      falta: money(Math.max(0, config.metaReserva - config.reserva)),
      aporte: money(reservaAutomatica.aporte),
      entradaNova: money(reservaAutomatica.entradaNova),
      percentual: taxaReserva,
      entradas7Dias: money(entradas7Dias),
      compraProtegida: money(reservaAutomatica.compraPlanejada),
      contasProtegidas: money(expensesTotal),
      estado: !config.proteger ? "pausada" : total === null ? "sem_saldo"
        : config.reserva >= config.metaReserva ? "concluida"
        : reservaAutomatica.inicioAgora ? "iniciando"
        : reservaAutomatica.entradaNova <= 0 ? "sem_entradas"
        : reservaAutomatica.aporte <= 0 ? "sem_margem" : "acumulando",
    },
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
    analiseGastos: { ultimos7Dias: money(last7.saidas), mediaSemanal4Semanas: avgExpenses === null ? null : money(avgExpenses), variacaoPercentual: expensesChange, semanasComRegistros: previous4.filter(p => p.registros > 0).length, entradas7Dias: money(last7.entradas), mediaEntradas4Semanas: avgRevenue === null ? null : money(avgRevenue), variacaoEntradasPercentual: revenueChange },
    compras: {
      totalSemana: money(week.compras), mediaSemanal: purchaseAverage === null ? null : money(purchaseAverage),
      menor: purchaseValues.length ? money(Math.min(...purchaseValues)) : null,
      maior: purchaseValues.length ? money(Math.max(...purchaseValues)) : null,
      tendencia: purchaseValues.length < 2 ? null : money(purchaseValues.at(-1)! - purchaseValues.at(-2)!),
      diaHabitual: preferredDay,
      semanasRegistradas: purchaseValues.length,
    },
    categorias: Object.fromEntries(Object.entries(week.categorias).map(([key, v]) => [key, money(v)])),
    maiorDespesa: biggestExpense ? {
      valor: money(cents(biggestExpense.valor)),
      motivo: biggestExpense.motivo,
      data: daySP(biggestExpense.createdAt),
      categoria: classificar(biggestExpense.categoria, biggestExpense.motivo) ?? "não classificada",
    } : null,
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
  const metaReserva = req.body?.metaReserva === undefined ? null : inputMoney(req.body.metaReserva);
  const proteger = req.body?.protecaoAtiva;
  if (reserva === null || meta === null || typeof proteger !== "boolean" ||
    (req.body?.metaReserva !== undefined && (metaReserva === null || reserva > metaReserva))) {
    res.status(400).json({ error: "Informe uma reserva atual que não ultrapasse a meta, a compra planejada e a proteção." }); return;
  }
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
      for (const [key, value] of [
        [keys.reserva, (reserva / 100).toFixed(2)],
        [keys.meta, (meta / 100).toFixed(2)],
        [keys.proteger, String(proteger)],
        ...(metaReserva !== null ? [[keys.metaReserva, (metaReserva / 100).toFixed(2)]] : []),
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

function formatConcern(a: { aconteceu: string; dado: string; impacto: string; continuidade: string; sugestao: string }) {
  return [`O que aconteceu? ${a.aconteceu}`, `Qual dado provocou o alerta? ${a.dado}`, `Como isso afetou o caixa? ${a.impacto}`, `O que pode acontecer se continuar? ${a.continuidade}`, `Qual ação considerar? ${a.sugestao}`].join("\n");
}

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
const insufficient = "Não tenho dados suficientes registrados no Caixa para calcular isso.";
function respostaConsultivaValida(resposta: string): boolean {
  const texto = normalize(resposta);
  if (/\b(errad[oa]s?|ruim|administrando mal|gastando demais|gastou demais)\b/.test(texto)) return false;
  if (texto === normalize(insufficient)) return true;
  return ["o que aconteceu?", "qual dado", "como isso afetou o caixa?", "o que pode acontecer se continuar?", "qual acao considerar?"].every(parte => texto.includes(parte));
}
router.post("/financeiro-ia/transcrever", async (req, res): Promise<void> => {
  const audioBase64 = req.body?.audioBase64;
  const mimeType = String(req.body?.mimeType ?? "").split(";")[0];
  if (typeof audioBase64 !== "string" || !audioBase64 || audioBase64.length > 7_000_000
    || audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)
    || !["audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg"].includes(mimeType)) {
    res.status(400).json({ error: "Envie um áudio válido de até 5 MB." });
    return;
  }
  if (Buffer.from(audioBase64, "base64").byteLength > 5 * 1024 * 1024) {
    res.status(413).json({ error: "Áudio muito grande. Faça uma pergunta mais curta." });
    return;
  }
  const key = req.ip ?? "sem-ip";
  const now = Date.now();
  if (voiceRequests.size > 2000) {
    for (const [ip, value] of voiceRequests) if (value.resetAt <= now) voiceRequests.delete(ip);
  }
  const previous = voiceRequests.get(key);
  if (previous && previous.resetAt > now && previous.count >= 8) {
    res.status(429).json({ error: "Muitas perguntas por voz. Aguarde um minuto." });
    return;
  }
  voiceRequests.set(key, previous && previous.resetAt > now
    ? { count: previous.count + 1, resetAt: previous.resetAt }
    : { count: 1, resetAt: now + 60_000 });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: "Transcreva literalmente a pergunta falada em português do Brasil. Não responda à pergunta, não acrescente informações e não invente valores. Retorne somente JSON no formato {\"pergunta\":\"texto ouvido\"}." },
        ],
      }],
      config: { responseMimeType: "application/json", maxOutputTokens: 500 },
    });
    const parsed: unknown = JSON.parse(response.text ?? "{}");
    const text = String((parsed as { pergunta?: unknown })?.pergunta ?? "").trim();
    if (!text || text.length > 400) {
      res.status(422).json({ error: "Não consegui entender a pergunta. Tente falar mais devagar." });
      return;
    }
    res.json({ pergunta: text });
  } catch (err) {
    req.log.warn({ err }, "financeiro-ia transcrição indisponível");
    res.status(502).json({ error: "Não consegui transcrever a pergunta agora. Tente novamente." });
  }
});

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
      if (saldo.disponivel === null) answer = insufficient;
      else if (target === null) answer = `Disponível sem usar a reserva: ${reais(Math.round(saldo.disponivel * 100))}. Informe o valor da compra para comparar.`;
      else if (target <= Math.round(saldo.disponivel * 100)) answer = `Compra consultada: ${reais(target)}; disponível sem usar a reserva: ${reais(Math.round(saldo.disponivel * 100))}. Cabe no caixa operacional registrado, antes de despesas futuras não cadastradas. Nenhum valor será movimentado automaticamente.`;
      else {
        const gap = target - Math.round(saldo.disponivel * 100);
        answer = formatConcern({
          aconteceu: "A compra consultada excede o caixa operacional registrado.",
          dado: `Compra: ${reais(target)}; disponível sem reserva: ${reais(Math.round(saldo.disponivel * 100))}; diferença: ${reais(gap)}.`,
          impacto: `Se a compra fosse paga agora em dinheiro/PIX, ultrapassaria o disponível em ${reais(gap)}. Nenhum valor foi movimentado.`,
          continuidade: "Se compras acima do disponível ocorrerem antes de novas entradas, a reserva poderá ser comprometida.",
          sugestao: "Considere ajustar a lista de peças ou aguardar entradas efetivamente recebidas; a decisão é sua."
        });
      }
    } else if (/quanto.*(gastar|retirar|separar para mim)/.test(q)) {
      answer = saldo.podeGastar === null ? insufficient
        : `Limite conservador registrado: ${reais(Math.round(saldo.podeGastar * 100))}. Cálculo: ${reais(Math.round(saldo.disponivel! * 100))} disponível − ${reais(Math.round(s.despesasPrevistas.total * 100))} em contas previstas nos próximos 7 dias − ${reais(Math.round(s.metaCompra * 100))} da meta de compra. Não inclui despesas não cadastradas.`;
    } else if (/reserva|disponivel|caixa/.test(q)) {
      answer = saldo.total === null ? insufficient
        : `Dinheiro físico: ${reais(Math.round(saldo.dinheiro! * 100))}; PIX líquido registrado: ${reais(Math.round(saldo.pix * 100))}; total: ${reais(Math.round(saldo.total * 100))}; reserva ${saldo.protecaoAtiva ? "protegida" : "desativada"}: ${reais(Math.round(saldo.reserva * 100))} de uma meta máxima de ${reais(Math.round(s.reservaAutomatica.meta * 100))}; disponível sem usar reserva: ${reais(Math.round(saldo.disponivel! * 100))}. Primeiro a entrada em dinheiro/PIX é registrada no saldo do Caixa; só depois uma parte da nova entrada pode aumentar a reserva, respeitando contas e pedidos. Nesta análise, a taxa foi ${s.reservaAutomatica.percentual}%. É uma proteção no cálculo do app, não uma transferência bancária. ${saldo.base}${s.observacoes.find(a => a.titulo === "Reserva abaixo da meta") ? `\n${formatConcern(s.observacoes.find(a => a.titulo === "Reserva abaixo da meta")!)}` : ""}`;
    } else if (/maior despesa/.test(q)) {
      answer = s.maiorDespesa
        ? `Maior saída registrada nos últimos 120 dias: ${reais(Math.round(s.maiorDespesa.valor * 100))}, ${s.maiorDespesa.motivo} (${s.maiorDespesa.categoria}), em ${s.maiorDespesa.data}.`
        : insufficient;
    } else if (/(preciso|falta).*fatur.*compra|quanto.*(proxima|pr[oó]xima) compra/.test(q)) {
      const goal = s.metaCompra > 0 ? s.metaCompra : s.compras.mediaSemanal;
      if (saldo.disponivel === null || goal === null) answer = insufficient;
      else {
        const gap = Math.max(0, Math.round((goal - saldo.disponivel) * 100));
        answer = gap === 0 ? `A ${s.metaCompra > 0 ? "meta planejada" : "média semanal registrada"} de ${reais(Math.round(goal * 100))} já cabe no disponível registrado de ${reais(Math.round(saldo.disponivel * 100))}, antes das contas futuras.` : formatConcern({
          aconteceu: "O disponível ainda está abaixo da próxima compra considerada.",
          dado: `Compra ${s.metaCompra > 0 ? "planejada" : "média registrada"}: ${reais(Math.round(goal * 100))}; disponível: ${reais(Math.round(saldo.disponivel * 100))}; diferença: ${reais(gap)}.`,
          impacto: `Sem novas entradas, uma compra desse valor ultrapassaria o disponível em ${reais(gap)}.`,
          continuidade: "Novas saídas antes da compra podem ampliar essa diferença; não é possível converter a diferença em faturamento bruto sem conhecer forma de recebimento e gastos futuros.",
          sugestao: "Considere acompanhar entradas efetivamente recebidas em dinheiro/PIX e revisar a compra antes de confirmá-la."
        });
      }
    } else if (/gasto.*mais|gastando demais/.test(q)) {
      const spendingAlert = s.observacoes.find(a => a.titulo === "Compras de peças acima da média" || a.titulo === "Saídas acima da média registrada");
      if (spendingAlert) {
        answer = formatConcern(spendingAlert);
      } else if (s.analiseGastos.mediaSemanal4Semanas === null) {
        answer = `${insufficient} Nos últimos 7 dias, as saídas registradas foram ${reais(Math.round(s.analiseGastos.ultimos7Dias * 100))}; não há registros em todas as quatro semanas anteriores para uma comparação responsável.`;
      } else {
        const a = s.analiseGastos;
        const percentual = a.variacaoPercentual;
        const direction = percentual === null ? "sem variação percentual calculável" : percentual > 0 ? `${percentual}% acima` : `${Math.abs(percentual)}% abaixo ou igual`;
        answer = [`O que aconteceu? As saídas registradas nos últimos 7 dias estão ${direction} da média recente.`,
          `Qual dado provocou a análise? Saídas: ${reais(Math.round(a.ultimos7Dias * 100))}; média semanal das quatro semanas anteriores: ${reais(Math.round(a.mediaSemanal4Semanas! * 100))}.`,
          `Como isso afetou o caixa? Essas saídas reduziram o fluxo em ${reais(Math.round(a.ultimos7Dias * 100))}; ${saldo.disponivel === null ? "não é possível calcular o disponível sem sessão da gaveta" : `o disponível atual, após outros movimentos e a reserva, é ${reais(Math.round(saldo.disponivel * 100))}`}.`,
          "O que pode acontecer se continuar? Saídas futuras sem entradas correspondentes podem reduzir a margem operacional; não é uma previsão certa.",
          "Qual ação considerar? Confira as categorias registradas e as contas previstas antes de decidir o próximo gasto."].join("\n");
      }
    } else if (/fatur|melhorando|evolu/.test(q)) {
      answer = s.semana.registros ? `Entradas hoje: ${reais(Math.round(s.dia.entradas * 100))}; nesta semana: ${reais(Math.round(s.semana.entradas * 100))}; semana anterior: ${reais(Math.round(s.comparacao.semanaAnterior.entradas * 100))}. Nos últimos 30 dias: ${reais(Math.round(s.mes.entradas * 100))}; 30 dias anteriores: ${reais(Math.round(s.comparacao.periodoAnterior.entradas * 100))}. A semana atual está em andamento; faturamento sozinho não mede lucro.`
        : insufficient;
    } else if (/lucro/.test(q)) {
      answer = s.semana.registros === 0 || s.semana.lucro === null ? insufficient
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
        compras: s.compras, analiseGastos: s.analiseGastos, observacoes: s.observacoes, despesasPrevistas: s.despesasPrevistas,
        estoqueBaixo: s.estoqueBaixo, avisos: s.avisos,
      });
      try {
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: `Você é um assistente financeiro de uma loja. Responda em português usando SOMENTE os fatos JSON a seguir; se a pergunta exigir dados ausentes, diga exatamente "${insufficient}". Nunca proponha ações automáticas, nunca invente valores nem faça julgamentos vagos (errado, ruim, administrando mal). Se identificar algo que merece atenção, use cinco partes: O que aconteceu? Qual dado provocou o alerta? Como isso afetou o caixa? O que pode acontecer se continuar? Qual ação considerar? Diferencie fatos de riscos condicionais, e deixe a decisão com o usuário. Fatos: ${facts}. Pergunta: ${question}`,
        });
        const generated = response.text?.trim() || insufficient;
        answer = respostaConsultivaValida(generated) ? generated : insufficient;
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