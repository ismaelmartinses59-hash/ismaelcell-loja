export const FINANCE_TIME_ZONE = "America/Sao_Paulo";

export function diaFinanceiroLocal(date: Date): number {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: FINANCE_TIME_ZONE }).format(date);
  return Math.floor(Date.parse(`${key}T12:00:00Z`) / 86400000);
}

export function dataFinanceiraLocal(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: FINANCE_TIME_ZONE }).format(date);
}

export function somarMovimentosElegiveisDoPeriodo(
  movimentos: {
    dia: number;
    tipo: string;
    formaPagamento: string | null;
    valorCentavos: number;
  }[],
  diaInicio: number,
  diaFim: number,
) {
  return movimentos.reduce((total, movimento) => {
    const elegivel = movimento.dia >= diaInicio &&
      movimento.dia <= diaFim &&
      (!movimento.formaPagamento || movimento.formaPagamento === "dinheiro" || movimento.formaPagamento === "pix");
    if (!elegivel || (movimento.tipo !== "entrada" && movimento.tipo !== "saida")) return total;
    if (movimento.tipo === "entrada") total.entradas += movimento.valorCentavos;
    else total.saidas += movimento.valorCentavos;
    return total;
  }, { entradas: 0, saidas: 0 });
}

export function calcularDisponibilidade(
  dinheiroCentavos: number | null,
  pixCentavos: number,
  reservaCentavos: number,
  protecaoAtiva: boolean,
  contasPrevistasCentavos: number,
  metaCompraCentavos: number,
) {
  if (dinheiroCentavos === null) {
    return { total: null, disponivel: null, podeGastar: null, faltaMeta: null };
  }
  const total = dinheiroCentavos + pixCentavos;
  const disponivel = Math.max(0, total - (protecaoAtiva ? reservaCentavos : 0));
  return {
    total,
    disponivel,
    podeGastar: Math.max(0, disponivel - contasPrevistasCentavos - metaCompraCentavos),
    faltaMeta: Math.max(0, metaCompraCentavos - disponivel),
  };
}

export function mediaDasSemanasComCompra(valoresCentavos: number[]): number | null {
  return valoresCentavos.length
    ? Math.round(valoresCentavos.reduce((soma, valor) => soma + valor, 0) / valoresCentavos.length)
    : null;
}

export function percentualReserva(entradas7Dias: number, mediaSemanal: number | null): 30 | 45 | 60 {
  if (mediaSemanal === null || mediaSemanal <= 0) return 45;
  if (entradas7Dias < mediaSemanal * 0.7) return 30;
  if (entradas7Dias > mediaSemanal * 1.3) return 60;
  return 45;
}

export function calcularRateioPeriodo(
  entradasCentavos: number,
  saidasCentavos: number,
  percentual: number,
  protecaoAtiva: boolean,
) {
  const entradas = Math.max(0, Math.trunc(entradasCentavos));
  const saidas = Math.max(0, Math.trunc(saidasCentavos));
  const percentualValido = Math.min(100, Math.max(0, percentual));
  const protecaoCentavos = protecaoAtiva
    ? Math.floor(entradas * percentualValido / 100)
    : 0;

  return {
    protecaoCentavos,
    // A proteção é uma referência, não uma saída de caixa.
    saldoOperacionalCentavos: entradas - saidas,
  };
}

export interface CicloReservaSemanal {
  chave: string;
  inicioDia: number;
  inicioId: number;
}

export function proximoCicloReservaSemanal(
  hojeDia: number,
  segundaDia: number,
  primeiraEntradaSegundaId: number | null,
  cicloAtual: CicloReservaSemanal | null,
): CicloReservaSemanal | null {
  const chaveFallback = `fallback:${segundaDia}`;
  if (cicloAtual?.chave === chaveFallback) return null;

  if (primeiraEntradaSegundaId !== null) {
    const chave = `venda:${segundaDia}:${primeiraEntradaSegundaId}`;
    if (cicloAtual?.chave === chave) return null;
    return { chave, inicioDia: segundaDia, inicioId: primeiraEntradaSegundaId };
  }

  if (hojeDia > segundaDia && cicloAtual?.chave !== chaveFallback) {
    return { chave: chaveFallback, inicioDia: segundaDia + 1, inicioId: 0 };
  }
  return null;
}

export function aumentoReservaDaSemana(
  aumentoTotal: number,
  entradasNovasTotal: number,
  entradasNovasDaSemana: number,
): number {
  if (aumentoTotal <= 0 || entradasNovasTotal <= 0 || entradasNovasDaSemana <= 0) return 0;
  const proporcao = Math.min(1, entradasNovasDaSemana / entradasNovasTotal);
  return Math.min(aumentoTotal, Math.floor(aumentoTotal * proporcao));
}

export function somarEntradasNovas(
  lancamentos: { id: number; tipo: string; formaPagamento: string | null; valorCentavos: number }[],
  ultimoId: number,
): number {
  return lancamentos.reduce((soma, lancamento) =>
    soma + (lancamento.id > ultimoId && lancamento.tipo === "entrada" &&
      (!lancamento.formaPagamento || lancamento.formaPagamento === "dinheiro" || lancamento.formaPagamento === "pix")
      ? lancamento.valorCentavos : 0), 0);
}

export function calcularReservaGradual(
  total: number | null,
  atual: number,
  contasPrevistas: number,
  compraPlanejada: number,
  percentual: number,
  entradaNova: number,
): number {
  if (total === null || entradaNova <= 0) return atual;
  const aposContas = Math.max(0, total - contasPrevistas);
  // Se a compra planejada não couber inteira, ainda deixa uma parte viável
  // para pedidos, em vez de impedir qualquer avanço da reserva.
  const pedidos = Math.min(compraPlanejada, Math.ceil(aposContas * (100 - percentual) / 100));
  const proximo = Math.min(atual + Math.floor(entradaNova * percentual / 100), aposContas - pedidos);
  // Uma semana ruim não desfaz a proteção já registrada.
  return Math.max(atual, proximo);
}