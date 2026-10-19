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
      (movimento.formaPagamento === "dinheiro" || movimento.formaPagamento === "pix");
    if (!elegivel || (movimento.tipo !== "entrada" && movimento.tipo !== "saida")) return total;
    if (movimento.tipo === "entrada") total.entradas += movimento.valorCentavos;
    else total.saidas += movimento.valorCentavos;
    return total;
  }, { entradas: 0, saidas: 0 });
}

export function separarSaidasDeSegundaDoFluxoOperacional(
  movimentos: {
    dia: number;
    tipo: string;
    formaPagamento: string | null;
    valorCentavos: number;
    categoria?: string | null;
  }[],
  segunda: number,
  fim: number,
) {
  const elegivel = (movimento: typeof movimentos[number]) =>
    movimento.dia >= segunda &&
    movimento.dia <= fim &&
    (movimento.formaPagamento === "dinheiro" || movimento.formaPagamento === "pix");
  const saidaElegivel = (movimento: typeof movimentos[number]) =>
    elegivel(movimento) && movimento.tipo === "saida";
  const debitarCicloAnterior = (movimento: typeof movimentos[number]) =>
    saidaElegivel(movimento) &&
    (movimento.dia === segunda || movimento.categoria === "pecas");
  const somarSaidas = (predicado: (movimento: typeof movimentos[number]) => boolean) =>
    movimentos.reduce((total, movimento) => predicado(movimento)
      ? total + Math.max(0, Math.trunc(movimento.valorCentavos))
      : total, 0);
  const saidasOperacionaisTotais = somarSaidas(saidaElegivel);
  const saidasCicloAnterior = somarSaidas(debitarCicloAnterior);
  const saidasSegunda = somarSaidas(movimento =>
    elegivel(movimento) && movimento.dia === segunda && movimento.tipo === "saida");
  const saidasPedidosEstoque = somarSaidas(movimento =>
    elegivel(movimento) && movimento.tipo === "saida" && movimento.categoria === "pecas");
  const movimentosDoCiclo = movimentos.filter(movimento =>
    !debitarCicloAnterior(movimento),
  );
  return {
    ...somarMovimentosElegiveisDoPeriodo(movimentosDoCiclo, segunda, fim),
    saidasSegunda,
    saidasPedidosEstoque,
    saidasCicloAnterior,
    saidasOperacionais: saidasOperacionaisTotais - saidasCicloAnterior,
  };
}

export function calcularSaldoOperacionalAcumulado(
  saldoAnteriorCentavos: number,
  alocacaoAtualCentavos: number,
  saidasOperacionaisCentavos: number,
): number {
  const saldoAnterior = Math.trunc(saldoAnteriorCentavos);
  const alocacaoAtual = Math.trunc(alocacaoAtualCentavos);
  const saidasOperacionais = Math.max(0, Math.trunc(saidasOperacionaisCentavos));
  return saldoAnterior + alocacaoAtual - saidasOperacionais;
}

/**
 * A operação pendente só passa para o saldo carregado quando há uma abertura
 * real do Caixa. A data do período identifica a virada pendente; reabrir ou
 * consultar o Financeiro no mesmo período não pode consolidar novamente.
 */
export function deveConsolidarOperacaoNaAbertura(
  periodoPendente: number,
  periodoJaConsolidado: number | null,
  aberturaRealDia: number | null,
): boolean {
  return aberturaRealDia !== null &&
    aberturaRealDia >= periodoPendente &&
    (periodoJaConsolidado === null || periodoPendente > periodoJaConsolidado);
}

export function calcularVariacaoOperacionalSemana(
  fluxoLiquidoCentavos: number,
  operacaoCentavos: number,
): number {
  const liquido = Math.trunc(fluxoLiquidoCentavos);
  return liquido < 0 ? liquido : Math.trunc(operacaoCentavos);
}

export function somarProtecaoPendenteSemanal(
  movimentos: {
    dia: number;
    tipo: string;
    formaPagamento: string | null;
    valorCentavos: number;
    categoria?: string | null;
  }[],
  inicioDia: number,
  fimDia: number,
  protecaoAtiva: boolean,
): number {
  if (!protecaoAtiva || fimDia < inicioDia) return 0;
  let total = 0;
  for (let inicio = inicioDia; inicio <= fimDia; inicio += 7) {
    const fluxo = separarSaidasDeSegundaDoFluxoOperacional(
      movimentos, inicio, Math.min(inicio + 6, fimDia),
    );
    total += calcularAlocacaoSemanal(
      fluxo.entradas, fluxo.saidas, null, 0, true,
    ).protecaoCentavos;
  }
  return total;
}

export function somarEntradasNovas(
  movimentos: {
    id: number;
    tipo: string;
    formaPagamento: string | null;
    valorCentavos: number;
  }[],
  cursor: number,
): number {
  return movimentos.reduce((total, movimento) => {
    if (
      movimento.id > cursor &&
      movimento.tipo === "entrada" &&
      (movimento.formaPagamento === "dinheiro" || movimento.formaPagamento === "pix")
    ) return total + Math.max(0, Math.trunc(movimento.valorCentavos));
    return total;
  }, 0);
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

export function calcularAlocacaoSemanal(
  entradasCentavos: number,
  saidasCentavos: number,
  mediaSemanalSaidasCentavos: number | null,
  compromissosCentavos: number,
  protecaoAtiva: boolean,
) {
  const entradas = Math.max(0, Math.trunc(entradasCentavos));
  const saidas = Math.max(0, Math.trunc(saidasCentavos));
  const fluxoLiquidoCentavos = entradas - saidas;
  const compromissos = Math.max(0, Math.trunc(compromissosCentavos));
  const mediaSaidas = mediaSemanalSaidasCentavos === null
    ? null
    : Math.max(0, Math.trunc(mediaSemanalSaidasCentavos));
  // A necessidade operacional é exibida à parte e não altera o rateio semanal de 60/40.
  const semNecessidadeConhecida = mediaSaidas === null || (mediaSaidas === 0 && compromissos === 0);
  const necessidadeOperacionalCentavos = semNecessidadeConhecida
    ? entradas
    : Math.max(mediaSaidas ?? 0, compromissos);
  // Só divide depois de calcular entradas menos saídas. A operação é arredondada
  // para centavos e a proteção recebe o restante para conservar o total exato.
  const fluxoPositivoCentavos = Math.max(0, fluxoLiquidoCentavos);
  const operacaoCentavos = !protecaoAtiva
    ? fluxoPositivoCentavos
    : Math.round(fluxoPositivoCentavos * 0.6);
  const protecaoCentavos = protecaoAtiva
    ? fluxoPositivoCentavos - operacaoCentavos
    : 0;
  const percentualProtecao = protecaoAtiva && fluxoPositivoCentavos > 0 ? 40 : 0;

  return {
    fluxoLiquidoCentavos,
    necessidadeOperacionalCentavos,
    operacaoCentavos,
    protecaoCentavos,
    percentualProtecao,
  };
}

export function calcularAumentoReservaSemanal(
  totalCaixaPixCentavos: number | null,
  reservaSemanaCentavos: number,
  protecaoAlocadaSemanaCentavos: number,
  entradaNovaElegivelCentavos: number,
  protecaoAtiva: boolean,
  reconciliarSemana = false,
): number {
  if (totalCaixaPixCentavos === null || !protecaoAtiva) return 0;
  const faltaProteger = Math.max(
    0,
    Math.trunc(protecaoAlocadaSemanaCentavos) -
      Math.max(0, Math.trunc(reservaSemanaCentavos)),
  );
  if (reconciliarSemana) return faltaProteger;
  if (entradaNovaElegivelCentavos <= 0) return 0;
  return Math.min(
    faltaProteger,
    Math.max(0, Math.trunc(entradaNovaElegivelCentavos)),
  );
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
