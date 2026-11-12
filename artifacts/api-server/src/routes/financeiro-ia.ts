import { Router, type IRouter } from "express";
import { and, desc, eq, gt, gte, isNotNull, isNull, lt, lte, sql } from "drizzle-orm";
import { db, appConfigTable, caixaTable, caixaSessoesTable, pecasTable, reservaAjustesTable, reservaUtilizacoesTable } from "@workspace/db";
import { requireFinanceSession } from "./auth";
import { ai } from "@workspace/integrations-gemini-ai";
import {
  calcularAlocacaoSemanal,
  calcularAlocacaoComSaldoAnterior,
  calcularDeficitOperacionalCarregado,
  calcularAjusteSaldoOperacionalAteAlvoCentavos,
  calcularAjusteReservaAteAlvoCentavos,
  calcularAjusteReservaSemanaFechada,
  calcularRateioConsolidadoNaAbertura,
  calcularDisponibilidade,
  dataFinanceiraLocal,
  diaFinanceiroLocal,
  calcularSaldoOperacionalAcumulado,
  calcularVariacaoOperacionalSemana,
  deveRepararSaldoOperacionalLegado,
  deveConsolidarOperacaoNaAbertura,
  separarSaidasDeSegundaDoFluxoOperacional,
  separarSaidasDoFluxoOperacionalV2,
  somarMovimentosElegiveisDoPeriodo,
  mediaDasSemanasComCompra,
  proximoCicloReservaSemanal,
  somarProtecaoPendenteSemanal,
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
  ultimoLancamentoReserva: "ia_fin_reserva_ultimo_lancamento",
  reservaSemana: "ia_fin_reserva_semanal_valor",
  cicloReservaSemana: "ia_fin_reserva_semanal_ciclo",
  reservaAberturaProcessada: "ia_fin_reserva_abertura_processada",
  reservaSemanaFechada: "ia_fin_reserva_semana_fechada_inicio",
  reservaFechamentoAuditoria: "ia_fin_reserva_fechamento_auditoria_",
  modeloAcumulacaoReserva: "ia_fin_reserva_modelo_acumulacao",
  operacaoSemana: "ia_fin_operacao_semana_inicio",
  operacaoSaldoBase: "ia_fin_operacao_saldo_base_centavos",
  operacaoAberturaAt: "ia_fin_operacao_abertura_at",
  operacaoModelo: "ia_fin_operacao_modelo",
  operacaoCorrecaoPedidoOutubro: "ia_fin_operacao_correcao_pedido_outubro_2026",
  operacaoCorrecaoPedidoOutubroDelta: "ia_fin_operacao_correcao_pedido_outubro_delta_centavos",
  operacaoMarcoCorrecaoSemana: "ia_fin_operacao_marco_correcao_semana_",
  reservaCorrecaoSaldoOutubro: "ia_fin_reserva_correcao_saldo_outubro_2026",
};
const MODELO_ACUMULACAO_RESERVA = "alocacao-semanal-fechamento-v2";
const MODELO_ACUMULACAO_OPERACAO_V2 = "pedidos-no-ciclo-anterior-v2";
const MODELO_ACUMULACAO_OPERACAO = "pedido-outubro-reclassificado-v4";
const CORRECAO_PEDIDO_OUTUBRO = {
  dia: Math.floor(Date.parse("2026-10-13T12:00:00.000Z") / 86400000),
  valor: 155000,
  reservaAdicional: 52773,
  saldoOperacaoInicial: 102979,
  saldoReservaAlvo: 272494,
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

function lerSaldoOperacionalAuditoria(value: string | undefined): number | null {
  if (value === undefined) return null;
  let auditoria: { saldoDeficitFinalCentavos?: unknown; saldoOperacionalFinalCentavos?: unknown };
  try {
    auditoria = JSON.parse(value);
  } catch {
    throw new Error("Auditoria do fechamento anterior está inválida");
  }
  const saldoFinal = auditoria.saldoOperacionalFinalCentavos ??
    auditoria.saldoDeficitFinalCentavos;
  if (saldoFinal === undefined) return null;
  if (!Number.isSafeInteger(saldoFinal)) {
    throw new Error("Saldo operacional da auditoria anterior está inválido");
  }
  return saldoFinal as number;
}

type MarcoCorrecaoOperacional = {
  semana: number;
  saldoBaseCentavos: number;
  entradasJaContadasCentavos: number;
  ultimoLancamentoId: number;
};

function lerMarcoCorrecaoOperacional(value: string | undefined): MarcoCorrecaoOperacional | null {
  if (value === undefined) return null;
  try {
    const marco = JSON.parse(value) as Partial<MarcoCorrecaoOperacional>;
    if (
      !Number.isSafeInteger(marco.semana) ||
      !Number.isSafeInteger(marco.saldoBaseCentavos) ||
      !Number.isSafeInteger(marco.entradasJaContadasCentavos) ||
      !Number.isSafeInteger(marco.ultimoLancamentoId) ||
      (marco.ultimoLancamentoId as number) < 0
    ) throw new Error();
    return marco as MarcoCorrecaoOperacional;
  } catch {
    throw new Error("Marco de correção operacional inválido");
  }
}

async function garantirMarcoCorrecaoOperacional(
  semana: number,
  saldoAnteriorAtual: number,
  entradasJaContadasCentavos: number,
  movimentos: { dia: number; id: number }[],
) {
  const key = `${keys.operacaoMarcoCorrecaoSemana}${semana}`;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
    const rows = await tx.select().from(appConfigTable).where(eq(appConfigTable.key, key)).limit(1);
    const salvo = lerMarcoCorrecaoOperacional(rows[0]?.value);
    if (salvo) {
      if (salvo.semana !== semana) throw new Error("Semana do marco operacional não corresponde");
      return salvo;
    }
    const semanaDaCorrecao = Math.floor(Date.parse("2026-11-09T12:00:00.000Z") / 86400000);
    if (
      semana !== semanaDaCorrecao ||
      saldoAnteriorAtual !== -182_114 ||
      entradasJaContadasCentavos < 247_000
    ) return null;

    const marco: MarcoCorrecaoOperacional = {
      semana,
      saldoBaseCentavos: -318_090,
      entradasJaContadasCentavos,
      ultimoLancamentoId: movimentos
        .filter(movimento => movimento.dia >= semana)
        .reduce((maior, movimento) => Math.max(maior, movimento.id), 0),
    };
    await tx.insert(appConfigTable).values({ key, value: JSON.stringify(marco) })
      .onConflictDoNothing({ target: appConfigTable.key });
    const [persistido] = await tx.select().from(appConfigTable)
      .where(eq(appConfigTable.key, key)).limit(1);
    return lerMarcoCorrecaoOperacional(persistido?.value);
  });
}

async function carregarSaldoOperacionalBase(
  semanaAtual: number,
  protecaoAtiva: boolean,
  aberturaRealAt: Date | null,
  movimentosAtuais: {
    dia: number;
    tipo: string;
    formaPagamento: string | null;
    valorCentavos: number;
    categoria?: string | null;
    createdAt?: Date;
  }[],
) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
    const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
    const semanaSalva = config.get(keys.operacaoSemana);
    const saldoSalvo = config.get(keys.operacaoSaldoBase);
    const modeloSalvo = config.get(keys.operacaoModelo);
    let aberturaPeriodoAt: Date | null = null;
    const aberturaSalva = config.get(keys.operacaoAberturaAt);
    if (aberturaSalva) {
      const parsed = new Date(aberturaSalva);
      if (!Number.isNaN(parsed.getTime())) aberturaPeriodoAt = parsed;
    }
    const periodoJaConsolidado = semanaSalva === undefined ? null : Number(semanaSalva);
    const aberturaRealDia = aberturaRealAt ? dayIndex(aberturaRealAt) : null;
    const consolidarAbertura = deveConsolidarOperacaoNaAbertura(
      semanaAtual, periodoJaConsolidado, aberturaRealDia,
    );
    let saldoBase: number;
    let operacaoPendente = 0;

    if (semanaSalva === undefined || saldoSalvo === undefined) {
      const anterior = somarMovimentosElegiveisDoPeriodo(movimentosAtuais, semanaAtual - 7, semanaAtual - 1);
      const rateioAnterior = calcularAlocacaoSemanal(
        anterior.entradas, anterior.saidas, null, 0, protecaoAtiva,
      );
      saldoBase = calcularVariacaoOperacionalSemana(
        rateioAnterior.fluxoLiquidoCentavos,
        rateioAnterior.operacaoCentavos,
      );
    } else {
      const inicioSalvo = Number(semanaSalva);
      const saldoLido = Number(saldoSalvo);
      if (!Number.isSafeInteger(inicioSalvo) || !Number.isSafeInteger(saldoLido) || inicioSalvo > semanaAtual) {
        throw new Error("Saldo operacional semanal inválido");
      }
      saldoBase = saldoLido;
      if (modeloSalvo !== MODELO_ACUMULACAO_OPERACAO && inicioSalvo === semanaAtual) {
        const semanaAnterior = semanaAtual - 7;
        const [rows, usosAtivos] = await Promise.all([
          tx.select({
            id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
            formaPagamento: caixaTable.formaPagamento, categoria: caixaTable.categoria,
            createdAt: caixaTable.createdAt,
          }).from(caixaTable)
            .where(gte(caixaTable.createdAt, new Date((semanaAnterior - 1) * 86400000))),
          tx.select({ caixaId: reservaUtilizacoesTable.caixaId }).from(reservaUtilizacoesTable)
            .where(isNull(reservaUtilizacoesTable.estornadaAt)),
        ]);
        const caixasDaReserva = new Set(usosAtivos.map(row => row.caixaId).filter((id): id is number => id !== null));
        const historico = rows.filter(row =>
          !caixasDaReserva.has(row.id) && (!aberturaPeriodoAt || row.createdAt > aberturaPeriodoAt),
        ).map(row => ({
          dia: dayIndex(row.createdAt), tipo: row.tipo, formaPagamento: row.formaPagamento,
          valorCentavos: cents(row.valor), categoria: row.categoria,
        }));
        const fluxoNovo = separarSaidasDeSegundaDoFluxoOperacional(
          historico, semanaAnterior, semanaAnterior + 6,
        );
        const rateioNovo = calcularAlocacaoSemanal(
          fluxoNovo.entradas, fluxoNovo.saidas, null, 0, protecaoAtiva,
        );
        const alocacaoNova = calcularVariacaoOperacionalSemana(
          rateioNovo.fluxoLiquidoCentavos, rateioNovo.operacaoCentavos,
        );
        if (modeloSalvo === MODELO_ACUMULACAO_OPERACAO_V2) {
          const fluxoV2 = separarSaidasDoFluxoOperacionalV2(
            historico, semanaAnterior, semanaAnterior + 6,
          );
          const rateioV2 = calcularAlocacaoSemanal(
            fluxoV2.entradas, fluxoV2.saidas, null, 0, protecaoAtiva,
          );
          const alocacaoV2 = rateioV2.operacaoCentavos;
          // Reverte a lógica v2, que debitou pedidos e outras saídas do saldo
          // carregado depois de já usá-los para reduzir a sobra semanal.
          const diferenca = fluxoV2.saidasCicloAnterior + fluxoV2.saidasOperacionais -
            fluxoNovo.saidasCicloAnterior + alocacaoNova - alocacaoV2;
          saldoBase += diferenca;
        } else {
          const fluxoAntigo = somarMovimentosElegiveisDoPeriodo(
            historico, semanaAnterior, semanaAnterior + 6,
          );
          const saidasRateioAntigo = fluxoAntigo.saidas - fluxoNovo.saidasSegunda;
          const alocacaoAntiga = calcularAlocacaoSemanal(
            fluxoAntigo.entradas, saidasRateioAntigo, null, 0, protecaoAtiva,
          ).operacaoCentavos;
          saldoBase += alocacaoNova - alocacaoAntiga;
        }
      }
      if (inicioSalvo < semanaAtual) {
        const [rows, usosAtivos] = await Promise.all([
          tx.select({
            id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
            formaPagamento: caixaTable.formaPagamento, categoria: caixaTable.categoria,
            createdAt: caixaTable.createdAt,
          }).from(caixaTable)
            .where(gte(caixaTable.createdAt, new Date((inicioSalvo - 1) * 86400000))),
          tx.select({ caixaId: reservaUtilizacoesTable.caixaId }).from(reservaUtilizacoesTable)
            .where(isNull(reservaUtilizacoesTable.estornadaAt)),
        ]);
        const caixasDaReserva = new Set(usosAtivos.map(row => row.caixaId).filter((id): id is number => id !== null));
        const historico = rows.filter(row =>
          !caixasDaReserva.has(row.id) && (!aberturaPeriodoAt || row.createdAt > aberturaPeriodoAt),
        ).map(row => ({
          dia: dayIndex(row.createdAt), tipo: row.tipo, formaPagamento: row.formaPagamento,
          valorCentavos: cents(row.valor), categoria: row.categoria,
        }));
        let saidasPendentes = 0;
        for (let inicio = inicioSalvo; inicio < semanaAtual; inicio += 7) {
          const fluxo = separarSaidasDeSegundaDoFluxoOperacional(historico, inicio, inicio + 6);
          saidasPendentes += fluxo.saidasCicloAnterior + fluxo.saidasOperacionais;
          saldoBase = calcularSaldoOperacionalAcumulado(saldoBase, 0, fluxo.saidasCicloAnterior);
          const rateio = calcularAlocacaoSemanal(
            fluxo.entradas, fluxo.saidas, null, 0, protecaoAtiva,
          );
          const variacaoOperacional = calcularVariacaoOperacionalSemana(
            rateio.fluxoLiquidoCentavos, rateio.operacaoCentavos,
          );
          if (!consolidarAbertura) operacaoPendente += rateio.operacaoCentavos;
          saldoBase = calcularSaldoOperacionalAcumulado(saldoBase, variacaoOperacional, 0);
        }
        if (!consolidarAbertura) saldoBase = saldoLido - saidasPendentes;
      }
    }
    if (consolidarAbertura && aberturaRealAt) {
      const [rows, usosAtivos] = await Promise.all([
        tx.select({
          id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
          formaPagamento: caixaTable.formaPagamento, categoria: caixaTable.categoria,
          createdAt: caixaTable.createdAt,
        }).from(caixaTable).where(and(
          gte(caixaTable.createdAt, new Date((semanaAtual - 1) * 86400000)),
          lte(caixaTable.createdAt, aberturaRealAt),
        )),
        tx.select({ caixaId: reservaUtilizacoesTable.caixaId }).from(reservaUtilizacoesTable)
          .where(isNull(reservaUtilizacoesTable.estornadaAt)),
      ]);
      const caixasDaReserva = new Set(usosAtivos.map(row => row.caixaId).filter((id): id is number => id !== null));
      const movimentosAntesAbertura = rows.filter(row => !caixasDaReserva.has(row.id)).map(row => ({
        dia: dayIndex(row.createdAt), tipo: row.tipo, formaPagamento: row.formaPagamento,
        valorCentavos: cents(row.valor), categoria: row.categoria,
      }));
      const fluxoPendente = separarSaidasDeSegundaDoFluxoOperacional(
        movimentosAntesAbertura, semanaAtual, dayIndex(aberturaRealAt),
      );
      const rateioPendente = calcularAlocacaoSemanal(
        fluxoPendente.entradas, fluxoPendente.saidas, null, 0, protecaoAtiva,
      );
      saldoBase = calcularSaldoOperacionalAcumulado(
        saldoBase, calcularVariacaoOperacionalSemana(
          rateioPendente.fluxoLiquidoCentavos, rateioPendente.operacaoCentavos,
        ), fluxoPendente.saidasCicloAnterior + fluxoPendente.saidasOperacionais,
      );
    }
    // A lista usada no rateio exclui saídas já financiadas pela reserva.
    // A correção histórica precisa validar o lançamento bruto do Caixa,
    // sem alterar a regra que evita descontar o mesmo gasto duas vezes.
    const pedidoOutubro = await tx.select({
      tipo: caixaTable.tipo,
      valor: caixaTable.valor,
      formaPagamento: caixaTable.formaPagamento,
      createdAt: caixaTable.createdAt,
    }).from(caixaTable).where(and(
      gte(caixaTable.createdAt, new Date((CORRECAO_PEDIDO_OUTUBRO.dia - 1) * 86400000)),
      lt(caixaTable.createdAt, new Date((CORRECAO_PEDIDO_OUTUBRO.dia + 2) * 86400000)),
    ));
    const orderPresent = pedidoOutubro.some(movimento =>
      dayIndex(movimento.createdAt) === CORRECAO_PEDIDO_OUTUBRO.dia &&
      movimento.tipo === "saida" &&
      (movimento.formaPagamento === "dinheiro" || movimento.formaPagamento === "pix") &&
      cents(movimento.valor) === CORRECAO_PEDIDO_OUTUBRO.valor,
    );
    let deltaOperacaoPendente = Number(config.get(keys.operacaoCorrecaoPedidoOutubroDelta) ?? "0");
    const saldoReservaAtual = cents(config.get(keys.reserva) ?? "0");
    const estadoOperacionalLegadoIncorreto = deveRepararSaldoOperacionalLegado(
      saldoBase,
      config.get(keys.operacaoCorrecaoPedidoOutubro),
      -144688,
    );
    if (orderPresent || estadoOperacionalLegadoIncorreto) {
      const correcaoOperacaoAplicada =
        config.get(keys.operacaoCorrecaoPedidoOutubro) === "aplicada-v2";
      const corrigirOperacao = !correcaoOperacaoAplicada ||
        config.get(keys.operacaoCorrecaoPedidoOutubroDelta) === undefined;
      if (corrigirOperacao) {
        // Corrige o valor final que o cartão mostra, preservando os débitos já
        // lançados e mantendo a operação semanal pendente até a abertura real.
        const ultimoDiaAtual = Math.max(
          semanaAtual,
          ...movimentosAtuais.map(movimento => movimento.dia).filter(dia => dia >= semanaAtual),
        );
        const saidasJaRegistradas = separarSaidasDeSegundaDoFluxoOperacional(
          movimentosAtuais, semanaAtual, ultimoDiaAtual,
        );
        deltaOperacaoPendente = calcularAjusteSaldoOperacionalAteAlvoCentavos(
          saldoBase,
          saidasJaRegistradas.saidasCicloAnterior + saidasJaRegistradas.saidasOperacionais,
          CORRECAO_PEDIDO_OUTUBRO.saldoOperacaoInicial,
        );
        const configuracoes: [string, string][] = [
          [keys.operacaoCorrecaoPedidoOutubroDelta, String(deltaOperacaoPendente)],
        ];
        if (orderPresent &&
          config.get(keys.operacaoCorrecaoPedidoOutubro) !== "aplicada" &&
          config.get(keys.operacaoCorrecaoPedidoOutubro) !== "aplicada-v2"
        ) {
          // R$ 1.319,32 reclassificados: R$ 791,59 operação + R$ 527,73 proteção.
          const reservaNova = cents(config.get(keys.reserva) ?? "0") +
            CORRECAO_PEDIDO_OUTUBRO.reservaAdicional;
          const reservaSemanaNova = cents(config.get(keys.reservaSemana) ?? "0") +
            CORRECAO_PEDIDO_OUTUBRO.reservaAdicional;
          configuracoes.push(
            [keys.reserva, (reservaNova / 100).toFixed(2)],
            [keys.reservaSemana, (reservaSemanaNova / 100).toFixed(2)],
          );
        }
        configuracoes.push([keys.operacaoCorrecaoPedidoOutubro, "aplicada-v2"]);
        for (const [key, value] of configuracoes) {
          await tx.insert(appConfigTable).values({ key, value })
            .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
        }
      }
      if (
        config.get(keys.reservaCorrecaoSaldoOutubro) !== "aplicada-v2" &&
        saldoReservaAtual < CORRECAO_PEDIDO_OUTUBRO.saldoReservaAlvo
      ) {
        const reservaAtual = saldoReservaAtual;
        const aumento = calcularAjusteReservaAteAlvoCentavos(
          reservaAtual, CORRECAO_PEDIDO_OUTUBRO.saldoReservaAlvo,
        );
        const reservaNova = reservaAtual + aumento;
        for (const [key, value] of [
          [keys.reserva, (reservaNova / 100).toFixed(2)],
          [keys.reservaCorrecaoSaldoOutubro, "aplicada-v2"],
        ]) await tx.insert(appConfigTable).values({ key, value })
          .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      }
    }
    if (!Number.isSafeInteger(deltaOperacaoPendente)) {
      throw new Error("Ajuste do saldo operacional de outubro inválido");
    }
    saldoBase += deltaOperacaoPendente;
    const semanaValor = String(semanaAtual);
    const saldoValor = String(saldoBase);
    if (consolidarAbertura && (
      config.get(keys.operacaoSemana) !== semanaValor ||
      config.get(keys.operacaoSaldoBase) !== saldoValor ||
      modeloSalvo !== MODELO_ACUMULACAO_OPERACAO ||
      (aberturaRealAt !== null && config.get(keys.operacaoAberturaAt) !== aberturaRealAt.toISOString()) ||
      deltaOperacaoPendente !== 0
    )) {
      for (const [key, value] of [
        [keys.operacaoSemana, semanaValor],
        [keys.operacaoSaldoBase, saldoValor],
        [keys.operacaoModelo, MODELO_ACUMULACAO_OPERACAO],
        ...(aberturaRealAt ? [[keys.operacaoAberturaAt, aberturaRealAt.toISOString()]] : []),
        ...(deltaOperacaoPendente !== 0
          ? [[keys.operacaoCorrecaoPedidoOutubroDelta, "0"]] : []),
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      aberturaPeriodoAt = aberturaRealAt;
    }
    // Sem abertura real, os períodos vencidos continuam pendentes e não podem
    // aumentar o limite operacional disponível para pedidos.
    return {
      saldoBase,
      aberturaPeriodoAt: consolidarAbertura ? aberturaRealAt : aberturaPeriodoAt,
      operacaoPendente: consolidarAbertura ? 0 : operacaoPendente,
    };
  });
}

class ReservaReconciliationRequiredError extends Error {
  constructor(readonly inicioDia: number) {
    super(
      `A correção da reserva da semana iniciada em ${daySP(new Date(inicioDia * 86400000 + 43200000))} excede o saldo atual; é necessária conciliação manual.`,
    );
    this.name = "ReservaReconciliationRequiredError";
  }
}

async function fecharSemanasDeReservaPendentes(
  semanaAtual: number,
  baseFisicaDisponivel: boolean,
  saldoCarryInicialSemana: number,
) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
    const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
    const ultimaSemanaFechada = semanaAtual - 7;
    const marcadorRaw = config.get(keys.reservaSemanaFechada);
    const marcador = marcadorRaw === undefined ? null : Number(marcadorRaw);
    if (marcador !== null && (!Number.isSafeInteger(marcador) || marcador > ultimaSemanaFechada)) {
      throw new Error("Marcador de fechamento da reserva inválido");
    }
    if (marcador === null) {
      // Establish a safe migration baseline; legacy reserve history needs reconciliation
      // before any already-closed week can be corrected automatically.
      for (const [key, value] of [
        [keys.reservaSemanaFechada, String(ultimaSemanaFechada)],
        [keys.modeloAcumulacaoReserva, MODELO_ACUMULACAO_RESERVA],
      ]) {
        await tx.insert(appConfigTable).values({ key, value })
          .onConflictDoUpdate({
            target: appConfigTable.key,
            set: { value, updatedAt: new Date() },
          });
      }
      return { ajuste: 0 };
    }
    const semanas = Array.from(
      { length: Math.max(0, Math.floor((ultimaSemanaFechada - marcador) / 7)) },
      (_, index) => marcador + (index + 1) * 7,
    );
    if (!semanas.length && config.get(keys.modeloAcumulacaoReserva) === MODELO_ACUMULACAO_RESERVA) {
      return { ajuste: 0 };
    }

    const primeiraSemana = semanas[0] ?? ultimaSemanaFechada;
    const [rows, ajustes] = await Promise.all([
      tx.select({
        id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
        formaPagamento: caixaTable.formaPagamento, categoria: caixaTable.categoria,
        createdAt: caixaTable.createdAt,
      }).from(caixaTable).where(gte(
        caixaTable.createdAt, new Date(((marcador ?? primeiraSemana) - 1) * 86400000),
      )),
      tx.select({
        aumento: reservaAjustesTable.aumento,
        ultimoLancamentoId: reservaAjustesTable.ultimoLancamentoId,
        createdAt: reservaAjustesTable.createdAt,
      }).from(reservaAjustesTable),
    ]);
    const cicloSalvo = lerCicloReservaSemanal(config.get(keys.cicloReservaSemana));
    const reservaSemanaSalva = cents(config.get(keys.reservaSemana) ?? "0");
    let reservaAtual = cents(config.get(keys.reserva) ?? "0");
    let ajusteTotal = 0;
    let saldoDeficitFechamento = saldoCarryInicialSemana;
    const auditoriaAnterior = marcador === null
      ? undefined
      : config.get(`${keys.reservaFechamentoAuditoria}${marcador}`);
    const saldoAuditado = lerSaldoOperacionalAuditoria(auditoriaAnterior);
    if (saldoAuditado !== null && saldoAuditado < 0) {
      saldoDeficitFechamento = saldoAuditado;
    } else if (marcador !== null) {
      const inicioAnterior = marcador;
      const fluxoAnterior = somarMovimentosElegiveisDoPeriodo(
        rows.filter(row => {
          const dia = dayIndex(row.createdAt);
          return dia >= inicioAnterior && dia <= inicioAnterior + 6;
        }).map(row => ({
          dia: dayIndex(row.createdAt),
          tipo: row.tipo,
          formaPagamento: row.formaPagamento,
          valorCentavos: cents(row.valor),
        })),
        inicioAnterior,
        inicioAnterior + 6,
      );
      saldoDeficitFechamento = calcularDeficitOperacionalCarregado(
        Number(config.get(keys.operacaoSaldoBase) ?? 0),
        fluxoAnterior.entradas,
        fluxoAnterior.saidas,
      );
    }
    if (!Number.isSafeInteger(saldoDeficitFechamento)) {
      throw new Error("Déficit operacional salvo inválido para fechar a reserva semanal");
    }
    let ultimaProcessada: number | null = marcador ?? ultimaSemanaFechada - 7;
    const idsDeAjuste = new Set(ajustes.map(ajuste => ajuste.ultimoLancamentoId));

    for (const inicio of semanas) {
      const fim = inicio + 6;
      const rowsDaSemana = rows.filter(row => {
        const dia = dayIndex(row.createdAt);
        return dia >= inicio && dia <= fim;
      });
      const idsDaSemana = new Set(rowsDaSemana.map(row => row.id));
      const movimentos = rowsDaSemana.map(row => ({
        dia: dayIndex(row.createdAt),
        tipo: row.tipo,
        formaPagamento: row.formaPagamento,
        valorCentavos: cents(row.valor),
        categoria: row.categoria,
      }));
      const fluxo = somarMovimentosElegiveisDoPeriodo(movimentos, inicio, fim);
      const saldoCarryInCentavos = saldoDeficitFechamento;
      const rateio = calcularAlocacaoComSaldoAnterior(
        saldoCarryInCentavos,
        fluxo.entradas,
        fluxo.saidas,
        config.get(keys.proteger) !== "false",
      );
      saldoDeficitFechamento = rateio.saldoOperacionalFinalCentavos;
      const ajustesDaSemana = ajustes.filter(ajuste => {
        const diaAjuste = dayIndex(ajuste.createdAt);
        return idsDaSemana.has(ajuste.ultimoLancamentoId) ||
          (diaAjuste >= inicio && diaAjuste <= fim);
      });
      const registrado = ajustesDaSemana.reduce((soma, ajuste) => soma + ajuste.aumento, 0);
      const reservaAnteriormenteAportada = ajustesDaSemana.length > 0
        ? registrado
        : cicloSalvo?.inicioDia === inicio ? reservaSemanaSalva : 0;
      const alvo = rateio.fluxoLiquidoCentavos <= 0
        ? 0
        : config.get(keys.proteger) === "false"
          ? Math.max(0, reservaAnteriormenteAportada)
          : rateio.protecaoCentavos;
      if (alvo > reservaAnteriormenteAportada && !baseFisicaDisponivel) break;
      const ajuste = calcularAjusteReservaSemanaFechada(
        alvo, reservaAnteriormenteAportada,
      );
      const saldoAntes = reservaAtual;
      const novoSaldo = reservaAtual + ajuste;
      if (novoSaldo < 0) {
        throw new ReservaReconciliationRequiredError(inicio);
      }
      reservaAtual = novoSaldo;
      ajusteTotal += ajuste;
      if (ajuste !== 0) {
        const movimentoAuditoria = [...rowsDaSemana]
          .sort((a, b) => b.id - a.id)
          .find(row => !idsDeAjuste.has(row.id));
        if (movimentoAuditoria) {
          await tx.insert(reservaAjustesTable).values({
            valorAnterior: saldoAntes,
            aumento: ajuste,
            valorNovo: novoSaldo,
            entradaNova: 0,
            percentual: 40,
            contasProtegidas: 0,
            pedidosProtegidos: 0,
            ultimoLancamentoId: movimentoAuditoria.id,
          });
          idsDeAjuste.add(movimentoAuditoria.id);
        }
      }
      const auditoria = JSON.stringify({
        inicio,
        fim,
        saldoCarryInCentavos,
        saldoOperacionalFinalCentavos: rateio.saldoOperacionalFinalCentavos,
        saldoDeficitFinalCentavos: saldoDeficitFechamento,
        fluxoLiquidoCentavos: rateio.fluxoLiquidoCentavos,
        protecaoAlvoCentavos: alvo,
        protecaoAnteriormenteAportadaCentavos: reservaAnteriormenteAportada,
        ajusteCentavos: ajuste,
      });
      const chaveAuditoria = `${keys.reservaFechamentoAuditoria}${inicio}`;
      await tx.insert(appConfigTable).values({ key: chaveAuditoria, value: auditoria })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: auditoria, updatedAt: new Date() },
        });
      ultimaProcessada = inicio;
    }

    const atualizacoes: [string, string][] = [
      [keys.modeloAcumulacaoReserva, MODELO_ACUMULACAO_RESERVA],
    ];
    if (ultimaProcessada !== null) {
      atualizacoes.push([keys.reservaSemanaFechada, String(ultimaProcessada)]);
    }
    if (ajusteTotal !== 0) atualizacoes.push([keys.reserva, (reservaAtual / 100).toFixed(2)]);
    if (ultimaProcessada !== null && cicloSalvo && cicloSalvo.inicioDia <= ultimaProcessada) {
      atualizacoes.push([keys.reservaSemana, "0.00"]);
    }
    for (const [key, value] of atualizacoes) {
      await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value, updatedAt: new Date() },
        });
    }
    return { ajuste: ajusteTotal };
  });
}

async function atualizarReservaGradual(
  total: number | null,
  reserva: number,
  reservaSemana: number,
  compraPlanejada: number,
  contasPrevistas: number,
  protecaoAlocadaSemana: number,
  necessidadeOperacional: number,
  percentualProtecao: number,
  hojeDia: number,
  segundaDia: number,
  aberturaRealAt: Date | null,
) {
  return db.transaction(async tx => {
    // Avança o marcador e a reserva juntos: repetir a consulta não duplica o aporte.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
    const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
    const atual = cents(config.get(keys.reserva) ?? (reserva / 100).toFixed(2));
    const ativa = config.get(keys.proteger) !== "false";
    const compra = Math.max(compraPlanejada, cents(config.get(keys.meta) ?? "0"));
    const marcador = config.get(keys.ultimoLancamentoReserva);
    const cicloSalvo = lerCicloReservaSemanal(config.get(keys.cicloReservaSemana));
    const aberturaRealDia = aberturaRealAt ? dayIndex(aberturaRealAt) : null;
    const aberturaJaProcessada = config.get(keys.reservaAberturaProcessada);
    const reservaJaConsolidadaDia = aberturaJaProcessada === undefined
      ? null : Number(aberturaJaProcessada);
    const consolidarNaAbertura = deveConsolidarOperacaoNaAbertura(
      segundaDia, reservaJaConsolidadaDia, aberturaRealDia,
    );
    if (!consolidarNaAbertura) {
      let protecaoPendente = 0;
      if (marcador !== undefined) {
        const cursorPendente = Number(marcador);
        if (!Number.isSafeInteger(cursorPendente) || cursorPendente < 0) {
          throw new Error("Marcador da reserva inválido");
        }
        const novosPendentes = await tx.select({
          id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
          formaPagamento: caixaTable.formaPagamento, categoria: caixaTable.categoria,
          createdAt: caixaTable.createdAt,
        }).from(caixaTable).where(gt(caixaTable.id, cursorPendente)).orderBy(caixaTable.id);
        const movimentosPendentes = novosPendentes.map(row => ({
          dia: dayIndex(row.createdAt), tipo: row.tipo, formaPagamento: row.formaPagamento,
          valorCentavos: cents(row.valor), categoria: row.categoria,
        }));
        protecaoPendente = somarProtecaoPendenteSemanal(
          movimentosPendentes, cicloSalvo?.inicioDia ?? segundaDia, hojeDia, ativa,
        );
      }
      return {
        reserva: atual,
        reservaSemana: cents(config.get(keys.reservaSemana) ?? (reservaSemana / 100).toFixed(2)),
        aporte: 0,
        entradaNova: 0,
        protecaoPendente,
        inicioAgora: false,
        compraPlanejada: 0,
        protecaoAtiva: ativa,
        saldosAtuais: null as { dinheiro: number; pix: number } | null,
      };
    }
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
      (row.formaPagamento === "dinheiro" || row.formaPagamento === "pix") &&
      cents(row.valor) > 0,
    )?.id ?? null;
    const proximoCiclo = proximoCicloReservaSemanal(
      hojeDia, segundaDia, primeiraEntradaSegundaId, cicloSalvo,
    );
    const ciclo = proximoCiclo ?? (cicloSalvo && cicloSalvo.inicioDia >= segundaDia
      ? cicloSalvo : {
      chave: `abertura:${segundaDia}`,
      inicioDia: segundaDia,
      inicioId: 0,
    });
    let reservaSemanaAtual = cents(config.get(keys.reservaSemana) ?? (reservaSemana / 100).toFixed(2));
    if (proximoCiclo || !cicloSalvo) {
      const ajustesDaSemana = await tx.select({
        aumento: reservaAjustesTable.aumento,
        movimentoAt: caixaTable.createdAt,
      }).from(reservaAjustesTable)
        .innerJoin(caixaTable, eq(caixaTable.id, reservaAjustesTable.ultimoLancamentoId))
        .where(gte(caixaTable.createdAt, new Date((ciclo.inicioDia - 1) * 86400000)));
      // Reconstrói a semana corrente a partir do histórico ao iniciar ou detectar um ciclo novo.
      const totalHistoricoSemana = ajustesDaSemana.reduce((soma, ajuste) => {
        const dia = dayIndex(ajuste.movimentoAt);
        return soma + (dia >= ciclo.inicioDia && dia <= hojeDia ? ajuste.aumento : 0);
      }, 0);
      const usosDaSemana = await tx.select({
        valorCentavos: reservaUtilizacoesTable.valorCentavos,
        createdAt: reservaUtilizacoesTable.createdAt,
        estornadaAt: reservaUtilizacoesTable.estornadaAt,
      }).from(reservaUtilizacoesTable)
        .where(gte(reservaUtilizacoesTable.createdAt, new Date((ciclo.inicioDia - 1) * 86400000)));
      const usoLiquido = usosDaSemana.reduce((soma, uso) => {
        const diaUso = dayIndex(uso.createdAt);
        if (diaUso < ciclo.inicioDia || diaUso > hojeDia) return soma;
        const diaEstorno = uso.estornadaAt ? dayIndex(uso.estornadaAt) : null;
        return soma - uso.valorCentavos + (diaEstorno !== null && diaEstorno >= ciclo.inicioDia && diaEstorno <= hojeDia
          ? uso.valorCentavos : 0);
      }, 0);
      reservaSemanaAtual = Math.min(atual, Math.max(0, totalHistoricoSemana + usoLiquido));
    }
    if (total === null) {
      const valorSemana = (reservaSemanaAtual / 100).toFixed(2);
      const cicloJson = JSON.stringify(ciclo);
      if (
        config.get(keys.reservaSemana) !== valorSemana ||
        config.get(keys.cicloReservaSemana) !== cicloJson ||
        config.get(keys.reservaAberturaProcessada) !== String(segundaDia)
      ) {
        for (const [key, value] of [
          [keys.reservaSemana, valorSemana],
          [keys.cicloReservaSemana, cicloJson],
          [keys.reservaAberturaProcessada, String(segundaDia)],
        ]) await tx.insert(appConfigTable).values({ key, value })
          .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      }
      return {
        reserva: atual,
        reservaSemana: reservaSemanaAtual,
        aporte: 0,
        entradaNova: 0,
        protecaoPendente: 0,
        inicioAgora: false,
        compraPlanejada: 0,
        protecaoAtiva: ativa,
        saldosAtuais: null as { dinheiro: number; pix: number } | null,
      };
    }
    if (marcador === undefined) {
      // Ao ativar o rastreamento, não reaproveita entradas antigas como se
      // tivessem acabado de ser recebidas.
      const [ultimo] = await tx.select({ id: caixaTable.id }).from(caixaTable)
        .where(aberturaRealAt ? lte(caixaTable.createdAt, aberturaRealAt) : undefined)
        .orderBy(desc(caixaTable.id)).limit(1);
      const reservaSemanaBase = reservaSemanaAtual;
      const aumentoInicial = 0;
      const reservaInicial = atual + aumentoInicial;
      reservaSemanaAtual = Math.min(reservaInicial, reservaSemanaBase + aumentoInicial);
      await tx.insert(appConfigTable).values({ key: keys.ultimoLancamentoReserva, value: String(ultimo?.id ?? 0) })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value: String(ultimo?.id ?? 0), updatedAt: new Date() } });
      for (const [key, value] of [
        [keys.reservaSemana, (reservaSemanaAtual / 100).toFixed(2)],
        [keys.cicloReservaSemana, JSON.stringify(ciclo)],
        [keys.reservaAberturaProcessada, String(segundaDia)],
        [keys.modeloAcumulacaoReserva, MODELO_ACUMULACAO_RESERVA],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      const aposContas = Math.max(0, total - contasPrevistas);
      return {
        reserva: reservaInicial,
        reservaSemana: reservaSemanaAtual,
        aporte: aumentoInicial,
        entradaNova: 0,
        protecaoPendente: 0,
        inicioAgora: true,
        compraPlanejada: Math.min(compra, Math.max(0, aposContas - reservaInicial)),
        protecaoAtiva: ativa,
        saldosAtuais: null as { dinheiro: number; pix: number } | null,
      };
    }
    const cursor = Number(marcador);
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Marcador da reserva inválido");
    const novos = await tx.select({
      id: caixaTable.id, tipo: caixaTable.tipo, valor: caixaTable.valor,
      formaPagamento: caixaTable.formaPagamento, categoria: caixaTable.categoria,
      createdAt: caixaTable.createdAt,
    }).from(caixaTable).where(gt(caixaTable.id, cursor)).orderBy(caixaTable.id);
    const usosAtivos = await tx.select({ caixaId: reservaUtilizacoesTable.caixaId })
      .from(reservaUtilizacoesTable).where(isNull(reservaUtilizacoesTable.estornadaAt));
    const caixasDaReserva = new Set(usosAtivos.map(row => row.caixaId).filter((id): id is number => id !== null));
    const novosProcessados = novos.filter(row =>
      !caixasDaReserva.has(row.id) && (!aberturaRealAt || row.createdAt <= aberturaRealAt),
    );
    const entradaNova = somarEntradasNovas(
      novosProcessados.map(row => ({ ...row, valorCentavos: cents(row.valor) })), cursor,
    );
    const inicioPendente = cicloSalvo?.inicioDia ?? segundaDia;
    const movimentosPendentes = novosProcessados.map(row => ({
      dia: dayIndex(row.createdAt), tipo: row.tipo, formaPagamento: row.formaPagamento,
      valorCentavos: cents(row.valor), categoria: row.categoria,
    }));
    const protecaoPendente = somarProtecaoPendenteSemanal(
      movimentosPendentes, inicioPendente, aberturaRealDia ?? hojeDia, ativa,
    );
    let dinheiroAtual: number | null = null;
    let pixAtual = 0;
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
      }
    }
    const totalAtual = dinheiroAtual === null ? total : dinheiroAtual + pixAtual;
    const reservaSemanaBase = reservaSemanaAtual;
    const aumentoPlanejado = 0;
    const novo = atual + aumentoPlanejado;
    const aposContas = Math.max(0, (totalAtual ?? 0) - contasPrevistas);
    const pedidosPreservados = Math.min(compra, Math.max(0, aposContas - novo));
    reservaSemanaAtual = Math.min(novo, reservaSemanaBase);
    const aumento = novo - atual;
    reservaSemanaAtual = Math.min(novo, reservaSemanaBase);
    // Sem base física, não consome a entrada; tenta novamente após abrir a gaveta.
    if (novosProcessados.length && (entradaNova === 0 || !ativa || dinheiroAtual !== null)) {
      await tx.insert(appConfigTable).values({ key: keys.ultimoLancamentoReserva, value: String(novosProcessados.at(-1)!.id) })
        .onConflictDoUpdate({
          target: appConfigTable.key,
          set: { value: String(novosProcessados.at(-1)!.id), updatedAt: new Date() },
        });
    }
    const reservaSemanaSalva = (reservaSemanaAtual / 100).toFixed(2);
    const cicloSalvoJson = JSON.stringify(ciclo);
    if (
      config.get(keys.reservaSemana) !== reservaSemanaSalva ||
      config.get(keys.cicloReservaSemana) !== cicloSalvoJson ||
      config.get(keys.reservaAberturaProcessada) !== String(segundaDia) ||
      config.get(keys.modeloAcumulacaoReserva) !== MODELO_ACUMULACAO_RESERVA
    ) {
      for (const [key, value] of [
        [keys.reservaSemana, reservaSemanaSalva],
        [keys.cicloReservaSemana, cicloSalvoJson],
        [keys.reservaAberturaProcessada, String(segundaDia)],
        [keys.modeloAcumulacaoReserva, MODELO_ACUMULACAO_RESERVA],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    }
    return {
      reserva: novo, reservaSemana: reservaSemanaAtual, aporte: novo - atual,
      entradaNova: dinheiroAtual === null ? 0 : entradaNova, inicioAgora: false,
      protecaoPendente,
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
  const [config, sessoes, cashRecent, pixRows, pecas, ultimoFechamento, reservaUsosAtivos] = await Promise.all([
    readConfig(),
    db.select().from(caixaSessoesTable).orderBy(desc(caixaSessoesTable.aberturaAt)).limit(1),
    db.select().from(caixaTable).where(gte(caixaTable.createdAt, new Date(Date.now() - 120 * 86400000))),
    db.select({ tipo: caixaTable.tipo, valor: caixaTable.valor })
      .from(caixaTable).where(eq(caixaTable.formaPagamento, "pix")),
    db.select().from(pecasTable),
    db.select({ fechamentoAt: caixaSessoesTable.fechamentoAt }).from(caixaSessoesTable)
      .where(isNotNull(caixaSessoesTable.fechamentoAt))
      .orderBy(desc(caixaSessoesTable.fechamentoAt)).limit(1),
    db.select({ caixaId: reservaUtilizacoesTable.caixaId }).from(reservaUtilizacoesTable)
      .where(isNull(reservaUtilizacoesTable.estornadaAt)),
  ]);
  // Despesas financiadas pela reserva continuam no Caixa real, mas não reduzem
  // novamente o orçamento operacional da IA.
  const caixasPagosPelaReserva = new Set(reservaUsosAtivos
    .map(row => row.caixaId).filter((id): id is number => id !== null));
  const recent = cashRecent.filter(row => !caixasPagosPelaReserva.has(row.id));
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
  const historicoSemanal = Array.from({ length: 12 }, (_, index) => {
    const inicio = weekStart - (index + 1) * 7;
    const fim = inicio + 6;
    const rows = cashRecent.filter(row => {
      const day = dayIndex(row.createdAt);
      return day >= inicio && day <= fim;
    });
    let entradas = 0;
    let saidas = 0;
    let saidasPagasPelaReserva = 0;
    const saidasPorCategoria: Record<string, number> = {};
    for (const row of rows) {
      const amount = cents(row.valor);
      if (row.tipo === "entrada") {
        entradas += amount;
        continue;
      }
      saidas += amount;
      const category = classificar(row.categoria, row.motivo) ?? "não categorizada";
      saidasPorCategoria[category] = (saidasPorCategoria[category] ?? 0) + amount;
      if (caixasPagosPelaReserva.has(row.id)) saidasPagasPelaReserva += amount;
    }
    return {
      inicio: daySP(new Date(inicio * 86400000 + 43200000)),
      fim: daySP(new Date(fim * 86400000 + 43200000)),
      entradas: money(entradas),
      saidas: money(saidas),
      liquido: money(entradas - saidas),
      saidasPorCategoria: Object.fromEntries(
        Object.entries(saidasPorCategoria).map(([category, amount]) => [category, money(amount)]),
      ),
      saidasPagasPelaReserva: money(saidasPagasPelaReserva),
      registros: rows.map(row => ({
        id: row.id,
        data: row.createdAt.toISOString(),
        tipo: row.tipo,
        valor: money(cents(row.valor)),
        formaPagamento: row.formaPagamento,
        categoria: row.tipo === "saida"
          ? classificar(row.categoria, row.motivo) ?? "não categorizada"
          : null,
        motivo: row.motivo,
        observacao: row.observacao,
        pagaPelaReserva: caixasPagosPelaReserva.has(row.id),
      })),
    };
  });
  const previousMonth = totalPeriod(today - 59, today - 30);
  const purchaseRows = recent.filter(row => row.tipo === "saida" &&
    (row.formaPagamento === "dinheiro" || row.formaPagamento === "pix") &&
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
  const movimentosRecentes = recent.map(row => ({
    id: row.id,
    dia: dayIndex(row.createdAt),
    createdAt: row.createdAt,
    tipo: row.tipo,
    formaPagamento: row.formaPagamento,
    valorCentavos: cents(row.valor),
    categoria: row.categoria,
  }));
  const estadoOperacional = await carregarSaldoOperacionalBase(
    weekStart, config.proteger, sessao?.aberturaAt ?? null, movimentosRecentes,
  );
  const aberturaNoPeriodoAtual = estadoOperacional.aberturaPeriodoAt !== null &&
    dayIndex(estadoOperacional.aberturaPeriodoAt) >= weekStart;
  const movimentosOperacionaisSemana = aberturaNoPeriodoAtual
    ? movimentosRecentes.filter(row => row.createdAt > estadoOperacional.aberturaPeriodoAt!)
    : movimentosRecentes;
  const fluxoOperacionalSemana = separarSaidasDeSegundaDoFluxoOperacional(
    movimentosOperacionaisSemana,
    aberturaNoPeriodoAtual ? dayIndex(estadoOperacional.aberturaPeriodoAt!) : weekStart,
    today,
  );
  const movimentosElegiveisSemana = {
    entradas: fluxoOperacionalSemana.entradas,
    saidas: fluxoOperacionalSemana.saidas,
  };
  const consolidadoNaAbertura = aberturaNoPeriodoAtual
    ? (() => {
        const aberturaAt = estadoOperacional.aberturaPeriodoAt!;
        const movimentosAntesDaAbertura = movimentosRecentes
          .filter(row => row.createdAt <= aberturaAt);
        const rateio = calcularRateioConsolidadoNaAbertura(
          movimentosAntesDaAbertura,
          weekStart,
          dayIndex(aberturaAt),
          config.proteger,
        );
        return {
          abertura: daySP(aberturaAt),
          entradas: money(rateio.entradasCentavos),
          saidas: money(rateio.saidasCentavos),
          liquido: money(rateio.liquidoCentavos),
          operacao: money(rateio.operacaoCentavos),
          protecao: money(rateio.protecaoCentavos),
        };
      })()
    : null;
  const periodosAnteriores = [1, 2, 3, 4].map(i => {
    const min = weekStart - i * 7, max = min + 6;
    const registros = movimentosRecentes.filter(row =>
      row.dia >= min && row.dia <= max &&
      (row.formaPagamento === "dinheiro" || row.formaPagamento === "pix") &&
      (row.tipo === "entrada" || row.tipo === "saida"),
    );
    return {
      saidas: registros.filter(row => row.tipo === "saida")
        .reduce((sum, row) => sum + row.valorCentavos, 0),
      comHistoricoElegivel: registros.length > 0,
    };
  });
  const mediaSemanalSaidas = periodosAnteriores.every(periodo => periodo.comHistoricoElegivel)
    ? Math.round(periodosAnteriores.reduce((sum, periodo) => sum + periodo.saidas, 0) / 4)
    : null;
  const compraOperacional = config.meta > 0 ? config.meta : purchaseAverage ?? 0;
  const alocacaoSemana = calcularAlocacaoSemanal(
    movimentosElegiveisSemana.entradas,
    movimentosElegiveisSemana.saidas,
    mediaSemanalSaidas,
    expensesTotal + compraOperacional,
    config.proteger,
  );
  let fluxoReservaSemana = somarMovimentosElegiveisDoPeriodo(
    movimentosRecentes, weekStart, today,
  );
  const auditoriaSemanaAnterior = config.rows.get(
    `${keys.reservaFechamentoAuditoria}${weekStart - 7}`,
  );
  const saldoCarryAuditado = lerSaldoOperacionalAuditoria(auditoriaSemanaAnterior);
  const saldoOperacionalAntesPedidos = estadoOperacional.saldoBase;
  const saldoOperacionalAnterior = calcularSaldoOperacionalAcumulado(
    saldoOperacionalAntesPedidos, 0, fluxoOperacionalSemana.saidasCicloAnterior,
  );
  const saldoCarryBaseSemana = aberturaNoPeriodoAtual
    ? saldoOperacionalAnterior
    : saldoOperacionalAntesPedidos;
  let saldoCarryInSemana = saldoCarryAuditado !== null
    ? saldoCarryAuditado
    : saldoCarryBaseSemana;
  const saldoCarryFechamentoReserva = saldoCarryInSemana;
  const marcoCorrecao = await garantirMarcoCorrecaoOperacional(
    weekStart,
    saldoCarryInSemana,
    fluxoReservaSemana.entradas,
    movimentosRecentes,
  );
  if (marcoCorrecao) {
    const movimentosAposMarco = movimentosRecentes.filter(row =>
      row.id > marcoCorrecao.ultimoLancamentoId && row.dia >= weekStart && row.dia <= today,
    );
    const fluxoAposMarco = somarMovimentosElegiveisDoPeriodo(
      movimentosAposMarco, weekStart, today,
    );
    saldoCarryInSemana = marcoCorrecao.saldoBaseCentavos;
    fluxoReservaSemana = {
      entradas: marcoCorrecao.entradasJaContadasCentavos + fluxoAposMarco.entradas,
      saidas: fluxoAposMarco.saidas,
    };
  }
  const saldoOperacionalInicialSemana = aberturaNoPeriodoAtual && estadoOperacional.aberturaPeriodoAt
    ? (() => {
        const aberturaAt = estadoOperacional.aberturaPeriodoAt!;
        const movimentosAntesAbertura = movimentosRecentes.filter(row =>
          row.createdAt <= aberturaAt && !caixasPagosPelaReserva.has(row.id),
        );
        const fluxoAntesAbertura = separarSaidasDeSegundaDoFluxoOperacional(
          movimentosAntesAbertura, weekStart, dayIndex(aberturaAt),
        );
        const rateioAntesAbertura = calcularAlocacaoSemanal(
          fluxoAntesAbertura.entradas, fluxoAntesAbertura.saidas, null, 0, config.proteger,
        );
        const variacaoAntiga = calcularVariacaoOperacionalSemana(
          rateioAntesAbertura.fluxoLiquidoCentavos, rateioAntesAbertura.operacaoCentavos,
        ) - fluxoAntesAbertura.saidasCicloAnterior - fluxoAntesAbertura.saidasOperacionais;
        return estadoOperacional.saldoBase - variacaoAntiga;
      })()
    : estadoOperacional.saldoBase;
  const alocacaoReservaSemana = calcularAlocacaoComSaldoAnterior(
    saldoCarryInSemana,
    fluxoReservaSemana.entradas,
    fluxoReservaSemana.saidas,
    config.proteger,
  );
  const resultadoOperacionalSemana = alocacaoReservaSemana.fluxoLiquidoCentavos;
  const saldoOperacionalDisponivel = alocacaoReservaSemana.saldoOperacionalFinalCentavos;
  const entradasSemana = fluxoReservaSemana.entradas;
  const taxaReserva = alocacaoReservaSemana.percentualProtecao;
  let conciliacaoReservaPendente: string | null = null;
  let fechamentoReserva = { ajuste: 0 };
  try {
    fechamentoReserva = await fecharSemanasDeReservaPendentes(
      weekStart, dinheiro !== null, saldoCarryFechamentoReserva,
    );
  } catch (error) {
    if (!(error instanceof ReservaReconciliationRequiredError)) throw error;
    conciliacaoReservaPendente = daySP(
      new Date(error.inicioDia * 86400000 + 43200000),
    );
  }
  const reservaAutomatica = conciliacaoReservaPendente
    ? {
        reserva: config.reserva,
        reservaSemana: config.reservaSemana,
        aporte: 0,
        entradaNova: 0,
        protecaoPendente: alocacaoReservaSemana.protecaoCentavos,
        inicioAgora: false,
        compraPlanejada: 0,
        protecaoAtiva: config.proteger,
        saldosAtuais: null as { dinheiro: number; pix: number } | null,
      }
    : await atualizarReservaGradual(
        dinheiro === null ? null : dinheiro + pix, config.reserva, config.reservaSemana,
        compraOperacional,
        expensesTotal,
        alocacaoReservaSemana.protecaoCentavos,
        alocacaoSemana.necessidadeOperacionalCentavos,
        taxaReserva,
        today,
        weekStart,
        sessao?.aberturaAt ?? null,
      );
  const historicoReserva = await db.select().from(reservaAjustesTable)
    .orderBy(desc(reservaAjustesTable.id));
  if (reservaAutomatica.saldosAtuais) {
    dinheiro = reservaAutomatica.saldosAtuais.dinheiro;
    pix = reservaAutomatica.saldosAtuais.pix;
  }
  const total = dinheiro === null ? null : dinheiro + pix;
  config.reserva = Math.max(
    0,
    reservaAutomatica.reserva -
      (reservaAutomatica.protecaoAtiva ? reservaAutomatica.reservaSemana : 0),
  );
  if (reservaAutomatica.protecaoAtiva !== null) config.proteger = reservaAutomatica.protecaoAtiva;
  const movimentosSemFormaSemana = movimentosRecentes.filter(row =>
    row.dia >= weekStart && row.dia <= today &&
    !row.formaPagamento &&
    (row.tipo === "entrada" || row.tipo === "saida"),
  );
  const semFormaEntradas = movimentosSemFormaSemana
    .filter(row => row.tipo === "entrada")
    .reduce((sum, row) => sum + row.valorCentavos, 0);
  const semFormaSaidas = movimentosSemFormaSemana
    .filter(row => row.tipo === "saida")
    .reduce((sum, row) => sum + row.valorCentavos, 0);
  const saldos = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, 0, 0);
  const disponivel = conciliacaoReservaPendente ? null : saldos.disponivel;
  const spending = calcularDisponibilidade(dinheiro, pix, config.reserva, config.proteger, expensesTotal, config.meta);
  const safeToSpend = conciliacaoReservaPendente ? null : spending.podeGastar;
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
    hoje: today, disponivel, total: conciliacaoReservaPendente ? null : total,
    reserva: config.reserva, proteger: config.proteger,
    mediaCompras: purchaseAverage, semanasComCompras: purchaseValues.length,
    contasPrevistas: expensesTotal, estoqueBaixo: stockLow,
  });
  const situacao = conciliacaoReservaPendente ? "atencao" :
    alerts.some(a => a.nivel === "risco") ? "risco" :
    alerts.some(a => a.nivel === "atencao") ? "atencao" :
    alerts.some(a => a.nivel === "positivo") ? "saudavel" : recent.length === 0 ? "sem_dados" : "sem_alertas";
  return {
    atualizadoEm: now.toISOString(),
    conciliacaoReservaPendente,
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
      reservaSemana: money(reservaAutomatica.reservaSemana),
      aporte: money(reservaAutomatica.aporte + fechamentoReserva.ajuste),
      entradaNova: money(reservaAutomatica.entradaNova),
      protecaoPendente: money(alocacaoReservaSemana.protecaoCentavos),
      percentual: taxaReserva,
      entradasSemana: money(entradasSemana),
      // Mantém o campo antigo para consumidores que ainda não migraram o nome.
      entradas7Dias: money(entradasSemana),
      compraProtegida: money(reservaAutomatica.compraPlanejada),
      contasProtegidas: money(expensesTotal),
      estado: fechamentoReserva.ajuste !== 0 ? "fechamento"
        : !config.proteger ? "pausada" : total === null ? "sem_saldo"
        : reservaAutomatica.aporte > 0 ? "acumulando"
        : reservaAutomatica.inicioAgora ? "iniciando"
        : reservaAutomatica.entradaNova <= 0 ? "sem_entradas"
        : "sem_aumento",
      historico: historicoReserva.map(ajuste => ({
        id: ajuste.id,
        data: ajuste.createdAt.toISOString(),
        anterior: money(ajuste.valorAnterior),
        aumento: money(ajuste.aumento),
        novo: money(ajuste.valorNovo),
        entradaNova: money(ajuste.entradaNova),
        percentual: ajuste.percentual,
        contasProtegidas: money(ajuste.contasProtegidas),
        pedidosProtegidos: money(ajuste.pedidosProtegidos),
      })),
    },
    movimentoSemana: {
      inicio: daySP(new Date(weekStart * 86400000 + 43200000)),
      fim: todayString,
      entradas: money(fluxoReservaSemana.entradas),
      saidas: money(fluxoReservaSemana.saidas),
      saldoCarryInSemana: money(saldoCarryInSemana),
      percentualProtecao: config.proteger ? taxaReserva : 0,
      protecao: money(alocacaoReservaSemana.protecaoCentavos),
      projecaoOperacaoSemana: money(alocacaoReservaSemana.operacaoCentavos),
      alocacaoOperacao: money(alocacaoReservaSemana.operacaoCentavos),
      operacaoPendente: money(
        estadoOperacional.operacaoPendente + alocacaoReservaSemana.operacaoCentavos,
      ),
      saldoOperacionalAntesPedidos: money(saldoOperacionalAntesPedidos),
      saldoOperacionalAnterior: money(saldoOperacionalAnterior),
      saidasSegunda: money(fluxoOperacionalSemana.saidasSegunda),
      saidasPedidosEstoque: money(fluxoOperacionalSemana.saidasPedidosEstoque),
      saidasCicloAnterior: money(fluxoOperacionalSemana.saidasCicloAnterior),
      saidasOperacionais: money(fluxoOperacionalSemana.saidasOperacionais),
      saldoOperacionalDisponivel: money(saldoOperacionalDisponivel),
      resultadoOperacionalSemana: money(resultadoOperacionalSemana),
      marcoCorrecaoOperacional: marcoCorrecao !== null,
      aberturaRealNoPeriodo: aberturaNoPeriodoAtual,
      consolidadoNaAbertura,
      necessidadeOperacional: money(alocacaoSemana.necessidadeOperacionalCentavos),
      saldoOperacional: money(alocacaoReservaSemana.saldoOperacionalFinalCentavos),
      entradasSemForma: money(semFormaEntradas),
      saidasSemForma: money(semFormaSaidas),
    },
    faltamMeta: spending.faltaMeta === null ? null : money(spending.faltaMeta),
    dia: { entradas: money(dia.entradas), saidas: money(dia.saidas), retiradas: money(dia.retiradas) },
    semana: {
      entradas: money(week.entradas), saidas: money(week.saidas),
      retiradas: money(week.retiradas), compras: money(week.compras),
      custo: money(week.custo), lucro: week.lucro === null ? null : money(week.lucro),
      registros: week.registros, custoAusente: week.custoAusente,
    },
    historicoSemanal,
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

router.get("/financeiro-ia/relatorio-semanal", async (req, res) => {
  const inicio = typeof req.query.inicio === "string" ? req.query.inicio : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) {
    res.status(400).json({ error: "Informe a segunda-feira inicial no formato AAAA-MM-DD." });
    return;
  }
  const inicioDia = dayIndex(new Date(`${inicio}T12:00:00.000Z`));
  const dataInicio = new Date(inicioDia * 86400000 + 43200000);
  if (daySP(dataInicio) !== inicio || dataInicio.getUTCDay() !== 1) {
    res.status(400).json({ error: "A data inicial precisa ser uma segunda-feira válida." });
    return;
  }
  const fimDia = inicioDia + 6;
  const limiteInferior = new Date((inicioDia - 1) * 86400000);
  const limiteSuperior = new Date((fimDia + 1) * 86400000);
  try {
    const [movimentosBrutos, usosBrutos, ajustesBrutos, config] = await Promise.all([
      db.select({
        id: caixaTable.id,
        tipo: caixaTable.tipo,
        valor: caixaTable.valor,
        formaPagamento: caixaTable.formaPagamento,
        categoria: caixaTable.categoria,
        motivo: caixaTable.motivo,
        observacao: caixaTable.observacao,
        createdAt: caixaTable.createdAt,
      }).from(caixaTable).where(and(
        gte(caixaTable.createdAt, limiteInferior),
        lt(caixaTable.createdAt, limiteSuperior),
      )).orderBy(caixaTable.createdAt, caixaTable.id),
      db.select({
        id: reservaUtilizacoesTable.id,
        valorCentavos: reservaUtilizacoesTable.valorCentavos,
        saldoAnteriorCentavos: reservaUtilizacoesTable.saldoAnteriorCentavos,
        saldoNovoCentavos: reservaUtilizacoesTable.saldoNovoCentavos,
        tipo: reservaUtilizacoesTable.tipo,
        categoria: reservaUtilizacoesTable.categoria,
        motivo: reservaUtilizacoesTable.motivo,
        descricao: reservaUtilizacoesTable.descricao,
        formaPagamento: reservaUtilizacoesTable.formaPagamento,
        caixaId: reservaUtilizacoesTable.caixaId,
        createdAt: reservaUtilizacoesTable.createdAt,
        estornadaAt: reservaUtilizacoesTable.estornadaAt,
        motivoEstorno: reservaUtilizacoesTable.motivoEstorno,
        saldoAnteriorEstornoCentavos: reservaUtilizacoesTable.saldoAnteriorEstornoCentavos,
        saldoNovoEstornoCentavos: reservaUtilizacoesTable.saldoNovoEstornoCentavos,
      }).from(reservaUtilizacoesTable),
      db.select({
        id: reservaAjustesTable.id,
        valorAnterior: reservaAjustesTable.valorAnterior,
        aumento: reservaAjustesTable.aumento,
        valorNovo: reservaAjustesTable.valorNovo,
        entradaNova: reservaAjustesTable.entradaNova,
        percentual: reservaAjustesTable.percentual,
        contasProtegidas: reservaAjustesTable.contasProtegidas,
        pedidosProtegidos: reservaAjustesTable.pedidosProtegidos,
        ultimoLancamentoId: reservaAjustesTable.ultimoLancamentoId,
        createdAt: reservaAjustesTable.createdAt,
      }).from(reservaAjustesTable),
      readConfig(),
    ]);
    const movimentos = movimentosBrutos.filter(row => {
      const dia = dayIndex(row.createdAt);
      return dia >= inicioDia && dia <= fimDia;
    });
    const idsMovimentos = new Set(movimentos.map(row => row.id));
    const diaNoPeriodo = (date: Date | null) => date !== null &&
      dayIndex(date) >= inicioDia && dayIndex(date) <= fimDia;
    const usos = usosBrutos.filter(uso =>
      idsMovimentos.has(uso.caixaId ?? -1) ||
      diaNoPeriodo(uso.createdAt) ||
      diaNoPeriodo(uso.estornadaAt),
    );
    const ajustes = ajustesBrutos.filter(ajuste =>
      idsMovimentos.has(ajuste.ultimoLancamentoId) ||
      diaNoPeriodo(ajuste.createdAt),
    );
    const caixasPagosPelaReserva = new Set(
      usos.filter(uso => uso.estornadaAt === null)
        .map(uso => uso.caixaId).filter((id): id is number => id !== null),
    );
    res.json({
      periodo: {
        inicio,
        fim: daySP(new Date(fimDia * 86400000 + 43200000)),
        fechado: fimDia < dayIndex(new Date()),
      },
      configuracaoReserva: {
        saldoProtegidoAtual: money(config.reserva),
        saldoSemanalAtual: money(config.reservaSemana),
        protecaoAtiva: config.proteger,
        cicloSemanal: config.rows.get(keys.cicloReservaSemana) ?? null,
        ultimoLancamentoLido: config.rows.get(keys.ultimoLancamentoReserva) ?? null,
        ultimaSemanaFechada: config.rows.get(keys.reservaSemanaFechada) ?? null,
        fechamentoDaSemana: config.rows.get(`${keys.reservaFechamentoAuditoria}${inicioDia}`) ?? null,
      },
      movimentosCaixa: movimentos.map(row => ({
        id: row.id,
        data: row.createdAt.toISOString(),
        tipo: row.tipo,
        valor: money(cents(row.valor)),
        formaPagamento: row.formaPagamento,
        categoria: row.categoria,
        motivo: row.motivo,
        observacao: row.observacao,
        pagaPelaReserva: caixasPagosPelaReserva.has(row.id),
      })),
      ajustesReserva: ajustes.map(row => ({
        id: row.id,
        criadoEm: row.createdAt.toISOString(),
        valorAnterior: money(row.valorAnterior),
        ajuste: money(row.aumento),
        valorNovo: money(row.valorNovo),
        entradaNova: money(row.entradaNova),
        percentual: row.percentual,
        contasProtegidas: money(row.contasProtegidas),
        pedidosProtegidos: money(row.pedidosProtegidos),
        lancamentoCaixaId: row.ultimoLancamentoId,
      })),
      utilizacoesReserva: usos.map(row => ({
        id: row.id,
        criadoEm: row.createdAt.toISOString(),
        valor: money(row.valorCentavos),
        saldoAnterior: money(row.saldoAnteriorCentavos),
        saldoNovo: money(row.saldoNovoCentavos),
        tipo: row.tipo,
        categoria: row.categoria,
        motivo: row.motivo,
        descricao: row.descricao,
        formaPagamento: row.formaPagamento,
        lancamentoCaixaId: row.caixaId,
        estornadoEm: row.estornadaAt?.toISOString() ?? null,
        motivoEstorno: row.motivoEstorno,
        saldoAnteriorEstorno: row.saldoAnteriorEstornoCentavos === null
          ? null : money(row.saldoAnteriorEstornoCentavos),
        saldoNovoEstorno: row.saldoNovoEstornoCentavos === null
          ? null : money(row.saldoNovoEstornoCentavos),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "financeiro-ia/relatorio-semanal");
    res.status(500).json({ error: "Não foi possível exportar a conciliação da semana." });
  }
});

router.put("/financeiro-ia/config", async (req, res) => {
  const reserva = inputMoney(req.body?.reserva);
  const meta = inputMoney(req.body?.metaCompra);
  const proteger = req.body?.protecaoAtiva;
  if (reserva === null || meta === null || typeof proteger !== "boolean") {
    res.status(400).json({ error: "Informe o saldo protegido atual, a compra planejada e o estado da proteção." }); return;
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
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    });
    res.json(await snapshot());
  } catch (err) { req.log.error({ err }, "financeiro-ia/config"); res.status(500).json({ error: "Não foi possível salvar a configuração." }); }
});

router.get("/financeiro-ia/reserva", async (_req, res) => {
  const [config, usos, saidas] = await Promise.all([
    readConfig(),
    db.select().from(reservaUtilizacoesTable).orderBy(desc(reservaUtilizacoesTable.createdAt)),
    db.select().from(caixaTable).where(eq(caixaTable.tipo, "saida")).orderBy(desc(caixaTable.createdAt)).limit(100),
  ]);
  const vinculadas = new Set(usos.filter(uso => uso.estornadaAt === null).map(uso => uso.caixaId).filter((id): id is number => id !== null));
  const saldo = cents(config.rows.get(keys.reserva) ?? "0");
  res.json({
    saldo: money(saldo),
    saidasDisponiveis: saidas.filter(saida => !vinculadas.has(saida.id)).map(saida => ({
      id: saida.id, valor: saida.valor, motivo: saida.motivo,
      categoria: saida.categoria, createdAt: saida.createdAt.toISOString(),
      formaPagamento: saida.formaPagamento,
    })),
    historico: usos.map(uso => ({
      id: `uso-${uso.id}`,
      usoId: uso.id,
      tipo: uso.tipo,
      valor: money(uso.valorCentavos),
      data: uso.createdAt.toISOString(),
      motivo: uso.motivo,
      estornada: uso.estornadaAt !== null,
    })).sort((a, b) => Date.parse(b.data) - Date.parse(a.data)),
  });
});

router.post("/financeiro-ia/reserva/utilizacoes", async (req, res) => {
  const requestKey = String(req.body?.requestKey ?? "").trim();
  const valorCentavos = inputMoney(req.body?.valor);
  const tipo = req.body?.tipo === "transferencia" ? "transferencia" : "despesa";
  const categoria = String(req.body?.categoria ?? "outros").trim().slice(0, 40);
  const motivo = String(req.body?.motivo ?? "").trim().slice(0, 120);
  const descricao = String(req.body?.descricao ?? "").trim().slice(0, 500) || null;
  const dataRaw = String(req.body?.data ?? "");
  const data = new Date(dataRaw);
  const caixaIdRaw = req.body?.caixaId;
  const caixaId = caixaIdRaw == null || caixaIdRaw === "" ? null : Number(caixaIdRaw);
  let forma = req.body?.formaPagamento === "pix" ? "pix" : req.body?.formaPagamento === "dinheiro" ? "dinheiro" : null;
  const origemDinheiro = String(req.body?.origemDinheiro ?? "").trim().slice(0, 80);
  if (tipo === "transferencia") forma = origemDinheiro || null;
  if (requestKey.length < 8 || requestKey.length > 120 || valorCentavos === null || valorCentavos <= 0 ||
    !motivo || !categoria || !Number.isFinite(data.getTime()) || data.getTime() > Date.now() ||
    (tipo === "despesa" && caixaId !== null && !Number.isSafeInteger(caixaId)) ||
    (tipo === "despesa" && caixaId === null && !forma)) {
    res.status(400).json({ error: "Informe valor, data/hora, motivo e os dados da saída." }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
      const [prior] = await tx.select().from(reservaUtilizacoesTable)
        .where(eq(reservaUtilizacoesTable.requestKey, requestKey)).for("update");
      if (prior) return { duplicated: true, id: prior.id };
      const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
      const saldoAnterior = cents(config.get(keys.reserva) ?? "0");
      if (valorCentavos > saldoAnterior) throw new Error("O valor ultrapassa o saldo protegido disponível.");
      let linkedCashId: number | null = null;
      let dataMovimento = data;
      if (tipo === "despesa") {
        if (caixaId !== null) {
          const [saida] = await tx.select().from(caixaTable).where(eq(caixaTable.id, caixaId)).for("update");
          if (!saida || saida.tipo !== "saida") throw new Error("Selecione uma saída válida do Caixa.");
          if (cents(saida.valor) !== valorCentavos) throw new Error("O valor precisa ser igual ao da saída já registrada.");
          dataMovimento = saida.createdAt;
          forma = saida.formaPagamento;
          const [usoExistente] = await tx.select({ id: reservaUtilizacoesTable.id })
            .from(reservaUtilizacoesTable)
            .where(and(eq(reservaUtilizacoesTable.caixaId, caixaId), isNull(reservaUtilizacoesTable.estornadaAt)));
          if (usoExistente) throw new Error("Esta saída já está vinculada a uma utilização da reserva.");
          linkedCashId = caixaId;
        } else {
          const [saida] = await tx.insert(caixaTable).values({
            tipo: "saida", valor: (valorCentavos / 100).toFixed(2).replace(".", ","),
            motivo, observacao: descricao, categoria, formaPagamento: forma,
            createdAt: data,
          }).returning({ id: caixaTable.id });
          linkedCashId = saida.id;
        }
      }
      const saldoNovo = saldoAnterior - valorCentavos;
      const saldoSemana = cents(config.get(keys.reservaSemana) ?? "0");
      await tx.insert(reservaUtilizacoesTable).values({
        requestKey, valorCentavos, saldoAnteriorCentavos: saldoAnterior,
        saldoNovoCentavos: saldoNovo, tipo, categoria, motivo, descricao,
        formaPagamento: forma, caixaId: linkedCashId, createdAt: dataMovimento,
      });
      for (const [key, value] of [
        [keys.reserva, (saldoNovo / 100).toFixed(2)],
        [keys.reservaSemana, (Math.min(saldoNovo, Math.max(0, saldoSemana - valorCentavos)) / 100).toFixed(2)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
      return { duplicated: false };
    });
    res.status(result.duplicated ? 200 : 201).json({ ...result, resumo: await snapshot() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível registrar a utilização.";
    res.status(message.includes("saldo protegido") || message.includes("vinculada") || message.includes("saída") ? 409 : 500)
      .json({ error: message });
  }
});

router.post("/financeiro-ia/reserva/utilizacoes/:id/estornar", async (req, res) => {
  const id = Number(req.params.id);
  const motivo = String(req.body?.motivo ?? "").trim().slice(0, 200) || "Utilização estornada";
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Utilização inválida." }); return; }
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(65812004)`);
      const [uso] = await tx.select().from(reservaUtilizacoesTable)
        .where(eq(reservaUtilizacoesTable.id, id)).for("update");
      if (!uso) throw new Error("Utilização não encontrada.");
      if (uso.estornadaAt) return;
      const config = new Map((await tx.select().from(appConfigTable)).map(row => [row.key, row.value]));
      const saldo = cents(config.get(keys.reserva) ?? "0");
      const semana = cents(config.get(keys.reservaSemana) ?? "0");
      const novo = saldo + uso.valorCentavos;
      const hoje = dayIndex(new Date());
      const semanaInicio = hoje - ((new Date(`${daySP(new Date())}T12:00:00Z`).getUTCDay() + 6) % 7);
      const semanaNova = dayIndex(uso.createdAt) >= semanaInicio
        ? Math.min(novo, semana + uso.valorCentavos) : Math.min(novo, semana);
      await tx.update(reservaUtilizacoesTable)
        .set({
          estornadaAt: new Date(), motivoEstorno: motivo,
          saldoAnteriorEstornoCentavos: saldo, saldoNovoEstornoCentavos: novo,
        })
        .where(eq(reservaUtilizacoesTable.id, id));
      for (const [key, value] of [
        [keys.reserva, (novo / 100).toFixed(2)],
        [keys.reservaSemana, (semanaNova / 100).toFixed(2)],
      ]) await tx.insert(appConfigTable).values({ key, value })
        .onConflictDoUpdate({ target: appConfigTable.key, set: { value, updatedAt: new Date() } });
    });
    res.json({ resumo: await snapshot() });
  } catch (err) {
    res.status(409).json({ error: err instanceof Error ? err.message : "Não foi possível estornar." });
  }
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
  if (amount === null || amount <= 0 || !motivo || !validDate ||
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
          { text: 'Transcreva o áudio em português. Responda somente como JSON válido no formato {"pergunta":"texto transcrito"}, sem markdown.' },
        ],
      }],
      config: { responseMimeType: "application/json", maxOutputTokens: 512 },
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
    const limiteOperacionalCentavos = Math.round(s.movimentoSemana.saldoOperacionalDisponivel * 100);
    let answer: string | null = null;
    const amount = question.match(/(?:r\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?)/i);
    const target = amount ? inputMoney(amount[1].replace(/\./g, "")) : null;
    if (/posso comprar|comprar.*peca|comprar.*estoque/.test(q)) {
      if (saldo.disponivel === null) answer = insufficient;
      else if (limiteOperacionalCentavos < 0) answer = `O saldo operacional está negativo em ${reais(Math.abs(limiteOperacionalCentavos))}. As próximas alocações de operação cobrirão esse déficit antes de liberar novos gastos. Nenhum valor foi movimentado.`;
      else if (target === null) answer = `Disponível após a reserva protegida: ${reais(Math.round(saldo.disponivel * 100))}. Saldo operacional acumulado: ${reais(limiteOperacionalCentavos)}. Margem conservadora depois das contas previstas e da meta de compra: ${saldo.podeGastar === null ? "indisponível" : reais(Math.round(saldo.podeGastar * 100))}. Informe o valor do pedido para comparar.`;
      else if (target > Math.round(saldo.disponivel * 100)) {
        const gap = target - Math.round(saldo.disponivel * 100);
        answer = formatConcern({
          aconteceu: "A compra consultada excede o disponível após a reserva protegida.",
          dado: `Compra: ${reais(target)}; disponível sem reserva: ${reais(Math.round(saldo.disponivel * 100))}; diferença: ${reais(gap)}.`,
          impacto: `Se a compra fosse paga agora em dinheiro/PIX, ultrapassaria o disponível em ${reais(gap)}. Nenhum valor foi movimentado.`,
          continuidade: "Se compras acima do disponível ocorrerem antes de novas entradas, a reserva poderá ser comprometida.",
          sugestao: "Considere ajustar a lista de peças ou aguardar entradas efetivamente recebidas; a decisão é sua."
        });
      } else if (target > limiteOperacionalCentavos) {
        const diferenca = target - limiteOperacionalCentavos;
        answer = `O pedido cabe no disponível após a reserva protegida, mas excede em ${reais(diferenca)} o saldo operacional acumulado de ${reais(limiteOperacionalCentavos)}. As saídas operacionais reduzem o saldo acumulado, e futuras alocações cobrem o déficit. Nenhum valor foi movimentado.`;
      } else if (saldo.podeGastar !== null && target > Math.round(saldo.podeGastar * 100)) {
        const margem = Math.round(saldo.podeGastar * 100);
        answer = `O pedido de ${reais(target)} cabe no disponível após a reserva protegida (${reais(Math.round(saldo.disponivel * 100))}), mas ultrapassa em ${reais(target - margem)} a margem conservadora (${reais(margem)}), que preserva contas previstas nos próximos 7 dias e a meta de compra. Ele pode comprometer esse planejamento; nenhum valor foi movimentado.`;
      } else if (saldo.podeGastar === null) {
        answer = `O pedido de ${reais(target)} cabe no disponível após a reserva protegida (${reais(Math.round(saldo.disponivel * 100))}), mas não há dados suficientes para confirmar que cabe sem afetar contas previstas e a meta de compra. Nenhum valor foi movimentado.`;
      } else {
        answer = `O pedido de ${reais(target)} cabe na margem conservadora de ${reais(Math.round(saldo.podeGastar * 100))}, após a reserva protegida, as contas previstas nos próximos 7 dias e a meta de compra. Nenhum valor foi movimentado automaticamente.`;
      }
    } else if (/quanto.*(gastar|retirar|separar para mim)/.test(q)) {
      const margemCaixa = saldo.podeGastar === null ? null : Math.round(saldo.podeGastar * 100);
      const limite = margemCaixa === null ? null : Math.min(margemCaixa, limiteOperacionalCentavos);
      answer = limite === null ? insufficient
        : limite < 0 ? `Não há limite para novos gastos: o saldo operacional está negativo em ${reais(Math.abs(limite))}. Futuras alocações de operação serão usadas para cobrir o déficit.`
        : `Limite conservador registrado: ${reais(limite)}. Considera a margem do Caixa após contas previstas e meta de compra (${reais(margemCaixa!)}) e o saldo operacional acumulado (${reais(limiteOperacionalCentavos)}); prevalece o menor. Não inclui despesas não cadastradas.`;
    } else if (/reserva|disponivel|caixa/.test(q)) {
      const entradas = s.movimentoSemana.entradas;
      const saidas = s.movimentoSemana.saidas;
      const liquidoCentavos = Math.round(s.movimentoSemana.saldoOperacional * 100);
      const positivo = Math.max(0, liquidoCentavos);
      answer = `Nesta semana, de ${s.movimentoSemana.inicio} até ${s.movimentoSemana.fim}, entraram ${reais(Math.round(entradas * 100))} e saíram ${reais(Math.round(saidas * 100))} em dinheiro/PIX. O saldo operacional considera o saldo anterior de ${reais(Math.round(s.movimentoSemana.saldoCarryInSemana * 100))}; após entradas e saídas, fica em ${reais(liquidoCentavos)}. ${positivo > 0 && s.saldos.protecaoAtiva ? `A projeção atual é ${reais(Math.round(s.movimentoSemana.protecao * 100))} para proteção e ${reais(Math.round(s.movimentoSemana.projecaoOperacaoSemana * 100))} para operação. A parcela de 40% só será incorporada à reserva no fechamento se a semana terminar positiva.` : positivo > 0 ? `Com a proteção desativada, a projeção de ${reais(positivo)} fica na operação.` : `Como o fluxo semanal não é positivo, não há rateio para a reserva; o saldo operacional negativo de ${reais(Math.abs(liquidoCentavos))} segue carregado.`} Esta projeção considera dinheiro/PIX e todas as saídas elegíveis. A reserva é uma classificação contábil, não uma transferência. O Caixa + PIX registrado soma ${saldo.total === null ? "indisponível" : reais(Math.round(saldo.total * 100))}; depois da reserva protegida de ${reais(Math.round(saldo.reserva * 100))}, ficam ${saldo.disponivel === null ? "indisponível" : reais(Math.round(saldo.disponivel * 100))} disponíveis. A margem conservadora após contas previstas e meta de compra é ${saldo.podeGastar === null ? "indisponível" : reais(Math.round(saldo.podeGastar * 100))}.`;
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
    if (
      /reserva|disponivel|caixa/.test(q) &&
      !/posso comprar|quanto.*(gastar|retirar|separar para mim)/.test(q)
    ) {
      const positivo = Math.max(0, Math.round(s.movimentoSemana.saldoOperacional * 100));
      answer = `Nesta semana, entraram ${reais(Math.round(s.movimentoSemana.entradas * 100))} e saíram ${reais(Math.round(s.movimentoSemana.saidas * 100))} em dinheiro/PIX. Somando o saldo anterior de ${reais(Math.round(s.movimentoSemana.saldoCarryInSemana * 100))}, o saldo operacional após os movimentos é ${reais(Math.round(s.movimentoSemana.saldoOperacional * 100))}. ${positivo > 0 && s.saldos.protecaoAtiva ? `A projeção é 40% (${reais(Math.round(s.movimentoSemana.protecao * 100))}) para proteção e 60% (${reais(Math.round(s.movimentoSemana.projecaoOperacaoSemana * 100))}) para operação.` : "O fluxo semanal não gera rateio positivo para a reserva."} Saldo operacional disponível: ${reais(Math.round(s.movimentoSemana.saldoOperacionalDisponivel * 100))}. Reserva protegida total: ${reais(Math.round(s.saldos.reserva * 100))}.`;
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
