import { Router, type IRouter } from "express";
import { and, desc, eq, gt, gte, isNotNull, sql } from "drizzle-orm";
import { db, appConfigTable, caixaTable, caixaSessoesTable, pecasTable, reservaAjustesTable } from "@workspace/db";
import { requireFinanceSession } from "./auth";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  aumentoReservaDaSemana,
  calcularDisponibilidade,
  calcularRateioDiario,
  calcularReservaGradual,
  dataFinanceiraLocal,
  diaFinanceiroLocal,
  somarMovimentosElegiveisDoDia,
  mediaDasSemanasComCompra,
  percentualReserva,
  proximoCicloReservaSemanal,
  somarEntradasNovas,
  type CicloReservaSemanal,
} from "./financeiro-ia-calculos.js";
import { analisarAlertasFinanceiros } from "./financeiro-ia-alertas.js";

const router: IRouter = Router();
router.use(requireFinanceSession);
const voiceRequests = new Map<string, { count: number; resetAt: number }>();

const keys = {
  reserva: "ia_fin_reserva_valor",
  proteger: "ia_fin_reserva_ativa",
  meta: "ia_fin_meta_compra",
  metaReserva: "ia_fin_meta_reserva",
  ultimoLancamentoReserva: "ia_fin_reserva_ultimo_lancamento",
  reservaSemana: "ia_fin_reserva_semanal_valor",
  cicloReservaSemana: "ia_fin_reserva_semanal_ciclo",
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
const daySP = dataFinanceiraLocal;
function daysAgo(days: number): string {
  return daySP(new Date(Date.now() - days * 86400000));
}
const dayIndex = diaFinanceiroLocal;
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
    reservaSemana: cents(config.get(keys.reservaSemana) ?? "0"),
    proteger: config.get(keys.proteger) !== "false",
    meta: cents(config.get(keys.meta) ?? "0"),
    metaReserva: cents(config.get(keys.metaReserva) ?? "1500"),
  };
}

function lerCicloReservaSemanal(value: string | undefined): CicloReservaSemanal | null {
  if (value === undefined) return null;
  try {
    const ciclo = JSON.parse(value) as Partial<CicloReservaSemanal>;
    if (
      typeof ciclo.chave !== "string" ||
      !Number.isSafeInteger(ciclo.inicioDia) ||
      !Number.isSafeInteger(ciclo.inicioId) ||
      (ciclo.inicioDia as number) < 0 ||
      (ciclo.inicioId as number) < 0
    ) throw new Error();
    return ciclo as CicloReservaSemanal;
  } catch {
    throw new Error("Ciclo semanal da reserva inválido");
  }
}

async function atualizarReservaGradual(
  total: number | null,
  reserva: number,
  reservaSemana: number,
  metaReserva: number,
  compraPlanejada: number,
  contasPrevistas: number,
  percentual: number,
  hojeDia: number,
  segundaDia: number,
) {
  return db.transaction(async tx => {
    // Avança o marcador e a reserva juntos: repetir a consulta não duplica o aporte.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
    const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
    const atual = cents(config.get(keys.reserva) ?? (reserva / 100).toFixed(2));
    const teto = cents(config.get(keys.metaReserva) ?? (metaReserva / 100).toFixed(2));
    const ativa = config.get(keys.proteger) !== "false";
    const compra = Math.max(compraPlanejada, cents(config.get(keys.meta) ?? "0"));
    const marcador = config.get(keys.ultimoLancamentoReserva);
    const cicloSalvo = lerCicloReservaSemanal(config.get(keys.cicloReservaSemana));
    // O limite inferior inclui qualquer fuso brasileiro; dayIndex aplica o fuso da loja.
    const entradasSegunda = await tx.select({
      id: caixaTable.id,
      tipo: caixaTable.tipo,
      valor: caixaTable.valor,
      formaPagamento: caixaTable.formaPagamento,
      createdAt: caixaTable.createdAt,
    }).from(caixaTable)
      .where(gte(caixaTable.createdAt, new Date((segundaDia - 1) * 86400000)))
      .orderBy(caixaTable.createdAt, caixaTable.id);
    const primeiraEntradaSegundaId = entradasSegunda.find(row =>
      dayIndex(row.createdAt) === segundaDia &&
      row.tipo === "entrada" &&
      (!row.formaPagamento || row.formaPagamento === "dinheiro" || row.formaPagamento === "pix") &&
      cents(row.valor) > 0,
    )?.id ?? null;
    const proximoCiclo = proximoCicloReservaSemanal(
      hojeDia, segundaDia, primeiraEntradaSegundaId, cicloSalvo,
    );
    const ciclo = proximoCiclo ?? cicloSalvo ?? {
      chave: `base:${segundaDia}`,
      inicioDia: segundaDia,
      inicioId: 0,
    };
    let reservaSemanaAtual = cents(config.get(keys.reservaSemana) ?? (reservaSemana / 100).toFixed(2));
    if (proximoCiclo || !cicloSalvo) {
      const ajustesDaSemana = await tx.select({
        aumento: reservaAjustesTable.aumento,
        createdAt: reservaAjustesTable.createdAt,
      }).from(reservaAjustesTable)
        .where(gte(reservaAjustesTable.createdAt, new Date((ciclo.inicioDia - 1) * 86400000)));
      // Reconstrói a semana corrente a partir do histórico ao iniciar ou detectar um ciclo novo.
      const totalHistoricoSemana = ajustesDaSemana.reduce((soma, ajuste) => {
        const dia = dayIndex(ajuste.createdAt);
        return soma + (dia >= ciclo.inicioDia && dia <= hojeDia ? ajuste.aumento : 0);
      }, 0);
      reservaSemanaAtual = Math.min(atual, totalHistoricoSemana);
    }
    if (total === null) {
      const valorSemana = (reservaSemanaAtual / 100).toFixed(2);
      const cicloJson = JSON.stringify(ciclo);
      if (
        config.get(keys.reservaSemana) !== valorSemana ||
        config.get(keys.cicloReservaSemana) !== cicloJson
      ) {
        for (const [key, value] of [
          [keys.reservaSemana, valorSemana],
          [keys.cicloReservaSemana, cicloJson],
        ]) await tx.insert(appConfigTable).values({ key, value })
          .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      }
      const aposContas = Math.max(0, -contasPrevistas);
      const pedidosPreservados = Math.min(compra, Math.ceil(aposContas * (100 - percentual) / 100));
      return {
        reserva: atual,
        reservaSemana: reservaSemanaAtual,
        metaReserva: teto,
        aporte: 0,
        entradaNova: 0,
        inicioAgora: false,
        compraPlanejada: Math.min(pedidosPreservados, Math.max(0, aposContas - atual)),
        protecaoAtiva: ativa,
        saldosAtuais: null as { dinheiro: number; pix: number } | null,
      };
    }
    if (marcador === undefined) {
      // Ao ativar o rastreamento, não reaproveita entradas antigas como se
      // tivessem acabado de ser recebidas.
      const [ultimo] = await tx.select({ id: caixaTable.id }).from(caixaTable).orderBy(desc(caixaTable.id)).limit(1);
      await tx.insert(appConfigTable).values({ key: keys.ultimoLancamentoReserva, value: String(ultimo?.id ?? 0) })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value: String(ultimo?.id ?? 0), updatedAt: new Date() } });
      for (const [key, value] of [
        [keys.reservaSemana, (reservaSemanaAtual / 100).toFixed(2)],
        [keys.cicloReservaSemana, JSON.stringify(ciclo)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      const aposContas = Math.max(0, total - contasPrevistas);
      const pedidos = Math.min(compra, Math.ceil(aposContas * (100 - percentual) / 100));
      return { reserva: atual, reservaSemana: reservaSemanaAtual, metaReserva: teto, aporte: 0, entradaNova: 0, inicioAgora: true, compraPlanejada: Math.min(pedidos, Math.max(0, aposContas - atual)), protecaoAtiva: ativa, saldosAtuais: null as { dinheiro: number; pix: number } | null };
    }
    const cursor = Number(marcador);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Marcador da reserva inválido");
    const novos = await tx.select({
      id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
      formaPagamento: caixaTable.formaPagamento, createdAt: caixaTable.createdAt,
    }).from(caixaTable).where(gt(caixaTable.id, cursor)).orderBy(caixaTable.id);
    const entradaNova = somarEntradasNovas(
      novos.map(row => ({ ...row, valorCentavos: cents(row.valor) })), cursor,
    );
    const entradaNovaSemana = novos.reduce((soma, row) => {
      const elegivel = row.tipo === "entrada" &&
        (!row.formaPagamento || row.formaPagamento === "dinheiro" || row.formaPagamento === "pix");
      const dia = dayIndex(row.createdAt);
      return soma + (elegivel && dia >= ciclo.inicioDia && dia <= hojeDia ? cents(row.valor) : 0);
    }, 0);
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
    reservaSemanaAtual = Math.min(novo, reservaSemanaAtual);
    const aumento = novo - atual;
    if (aumento > 0 && entradaNova > 0 && entradaNovaSemana > 0) {
      reservaSemanaAtual += aumentoReservaDaSemana(aumento, entradaNova, entradaNovaSemana);
      // A reserva da semana é parte do total protegido, nunca um valor adicional.
      reservaSemanaAtual = Math.min(novo, reservaSemanaAtual);
    }
    if (novo > atual) {
      await tx.insert(appConfigTable).values({ key: keys.reserva, value: (novo / 100).toFixed(2) })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: (novo / 100).toFixed(2), updatedAt: new Date() },
        });
      await tx.insert(reservaAjustesTable).values({
        valorAnterior: atual,
        aumento: novo - atual,
        valorNovo: novo,
        entradaNova,
        percentual,
        contasProtegidas: contasPrevistas,
        pedidosProtegidos: Math.min(pedidosPreservados, Math.max(0, aposContas - novo)),
        ultimoLancamentoId: novos.at(-1)!.id,
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
    const reservaSemanaSalva = (reservaSemanaAtual / 100).toFixed(2);
    const cicloSalvoJson = JSON.stringify(ciclo);
    if (
      config.get(keys.reservaSemana) !== reservaSemanaSalva ||
      config.get(keys.cicloReservaSemana) !== cicloSalvoJson
    ) {
      for (const [key, value] of [
        [keys.reservaSemana, reservaSemanaSalva],
        [keys.cicloReservaSemana, cicloSalvoJson],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    }
    return {
      reserva: novo, reservaSemana: reservaSemanaAtual, metaReserva: teto, aporte: novo - atual,
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
  const [config, sessoes, recent, pixRows, pecas, ultimoFechamento] = await Promise.all([
    readConfig(),
    db.select().from(caixaSessoesTable).orderBy(desc(caixaSessoesTable.aberturaAt)).limit(1),
    db.select().from(caixaTable).where(gte(caixaTable.createdAt, new Date(Date.now() - 120 * 86400000))),
    db.select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
      .from(caixaTable).where(eq(caixaTable.formaPagamento, "pix")),
    db.select().from(pecasTable),
    db.select({ fechamentoAt: caixaSessoesTable.fechamentoAt }).from(caixaSessoesTable)
      .where(isNotNull(caixaSessoesTable.fechamentoAt))
      .orderBy(desc(caixaSessoesTable.fechamentoAt)).limit(1),
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
  const entradasSemana = entradasLiquidas(weekStart, today);
  const periodosAnteriores = [1, 2, 3, 4].map(i => {
    const min = weekStart - i * 7, max = min + 6;
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
  const taxaReserva = percentualReserva(entradasSemana, mediaEntradas);
  const reservaAutomatica = await atualizarReservaGradual(
    dinheiro === null ? null : dinheiro + pix, config.reserva, config.reservaSemana, config.metaReserva,
    config.meta > 0 ? config.meta : purchaseAverage ?? 0,
    expensesTotal, taxaReserva, today, weekStart,
  );
  const historicoReserva = await db.select().from(reservaAjustesTable)
    .orderBy(desc(reservaAjustesTable.id));
  if (reservaAutomatica.saldosAtuais) {
    dinheiro = reservaAutomatica.saldosAtuais.dinheiro;
    pix = reservaAutomatica.saldosAtuais.pix;
  }
  const total = dinheiro === null ? null : dinheiro + pix;
  config.reserva = reservaAutomatica.reserva;
  config.metaReserva = reservaAutomatica.metaReserva;
  if (reservaAutomatica.protecaoAtiva !== null) config.proteger = reservaAutomatica.protecaoAtiva;
  const movimentosElegiveisHoje = somarMovimentosElegiveisDoDia(recent.map(row => ({
    dia: dayIndex(row.createdAt),
    tipo: row.tipo,
    formaPagamento: row.formaPagamento,
    valorCentavos: cents(row.valor),
  })), today);
  const entradasElegiveisHoje = movimentosElegiveisHoje.entradas;
  const saidasElegiveisHoje = movimentosElegiveisHoje.saidas;
  const aumentoAutomaticoHoje = historicoReserva.reduce((soma, ajuste) =>
    soma + (daySP(ajuste.createdAt) === todayString && ajuste.entradaNova > 0 ? ajuste.aumento : 0), 0);
  const reservaNoInicioDoDia = Math.max(0, config.reserva - aumentoAutomaticoHoje);
  const limiteProtecaoHoje = Math.max(0, config.metaReserva - reservaNoInicioDoDia);
  const rateioHoje = calcularRateioDiario(
    entradasElegiveisHoje,
    saidasElegiveisHoje,
    taxaReserva,
    config.proteger,
    limiteProtecaoHoje,
  );
  const saldos = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, 0, 0);
  const disponivel = saldos.disponivel;
  const spending = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, expensesTotal, config.meta);
  const safeToSpend = spending.podeGastar;
  const recentDays = totalPeriod(today - 27, today);
  const distinctDays = new Set(recent.filter(row => dayIndex(row.createdAt) >= today - 27)
    .map(row => daySP(row.createdAt))).size;
  const projected = total === null || distinctDays < 7 ? null
    : total + Math.round((recentDays.entradas - recentDays.saidas) / 28 * 7);
  const { alertas: alerts, analiseGastos } = analisarAlertasFinanceiros({
    movimentos: recent.map(row => ({
      dia: dayIndex(row.createdAt),
      tipo: row.tipo === "entrada" ? "entrada" as const : "saida" as const,
      valor: cents(row.valor),
      categoria: row.tipo === "saida" ? classificar(row.categoria, row.motivo) : null,
    })),
    hoje: today, disponivel, total, reserva: config.reserva, proteger: config.proteger,
    mediaCompras: purchaseAverage, semanasComCompras: purchaseValues.length,
    contasPrevistas: expensesTotal, estoqueBaixo: stockLow,
  });
  const situacao = alerts.some(a => a.nivel === "risco") ? "risco" :
    alerts.some(a => a.nivel === "atencao") ? "atencao" :
    alerts.some(a => a.nivel === "positivo") ? "saudavel" : recent.length === 0 ? "sem_dados" : "sem_alertas";
  return {
    atualizadoEm: now.toISOString(),
    ultimoFechamentoCaixa: ultimoFechamento[0]?.fechamentoAt?.toISOString() ?? null,
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
      reservaSemana: money(reservaAutomatica.reservaSemana),
      aporte: money(reservaAutomatica.aporte),
      entradaNova: money(reservaAutomatica.entradaNova),
      percentual: taxaReserva,
      entradasSemana: money(entradasSemana),
      // Mantém o campo antigo para consumidores que ainda não migraram o nome.
      entradas7Dias: money(entradasSemana),
      compraProtegida: money(reservaAutomatica.compraPlanejada),
      contasProtegidas: money(expensesTotal),
      estado: !config.proteger ? "pausada" : total === null ? "sem_saldo"
        : config.reserva >= config.metaReserva ? "concluida"
        : reservaAutomatica.inicioAgora ? "iniciando"
        : reservaAutomatica.entradaNova <= 0 ? "sem_entradas"
        : reservaAutomatica.aporte <= 0 ? "sem_margem" : "acumulando",
    },
    movimentoHoje: {
      data: todayString,
      entradas: money(entradasElegiveisHoje),
      saidas: money(saidasElegiveisHoje),
      percentualProtecao: config.proteger ? taxaReserva : 0,
      protecao: money(rateioHoje.protecaoCentavos),
      saldoOperacional: money(rateioHoje.saldoOperacionalCentavos),
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
    analiseGastos,
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
      const rows = await tx.select().from(appConfigTable);
      const semanaManual = Math.min(
        reserva,
        cents(new Map(rows.map(row => [row.key, row.value])).get(keys.reservaSemana) ?? "0"),
      );
      for (const [key, value] of [
        [keys.reserva, (reserva / 100).toFixed(2)],
        [keys.reservaSemana, (semanaManual / 100).toFixed(2)],
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
        const gap = Math.max(0, target - Math.round(saldo.disponivel * 100));
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
        : `Hoje (${s.movimentoHoje.data}) entraram ${reais(Math.round(s.movimentoHoje.entradas * 100))} em dinheiro/PIX. A proteção calculada sobre as entradas de hoje é ${reais(Math.round(s.movimentoHoje.protecao * 100))} (${s.movimentoHoje.percentualProtecao}% pela taxa semanal), e o saldo operacional de hoje é ${reais(Math.round(s.movimentoHoje.saldoOperacional * 100))}, após descontar ${reais(Math.round(s.movimentoHoje.saidas * 100))} em saídas registradas hoje. Esse saldo operacional considera somente hoje: não inclui saldo nem proteção de semanas anteriores. Saldo protegido nesta semana: ${reais(Math.round(s.reservaAutomatica.reservaSemana * 100))}, somente o ciclo atual. Saldo protegido total: ${reais(Math.round(saldo.reserva * 100))}, incluindo as semanas anteriores e a atual; meta máxima ${reais(Math.round(s.reservaAutomatica.meta * 100))}. A proteção total está ${saldo.protecaoAtiva ? "ativa" : "desativada"}. O resumo diário recomeça à meia-noite local e considera apenas entradas em dinheiro/PIX, sem cartão ou abertura da gaveta. O rateio diário é uma referência, não movimenta dinheiro; a reserva automática continua respeitando o teto, as contas previstas e os pedidos.`;
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
