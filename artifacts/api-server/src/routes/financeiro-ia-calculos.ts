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

export function calcularReservaGradual(
  total: number | null,
  atual: number,
  meta: number,
  contasPrevistas: number,
  compraPlanejada: number,
  percentual: number,
): number {
  if (total === null) return atual;
  const aposContas = Math.max(0, total - contasPrevistas);
  // Se a compra planejada não couber inteira, ainda deixa uma parte viável
  // para pedidos, em vez de impedir qualquer avanço da reserva.
  const pedidos = Math.min(compraPlanejada, Math.ceil(aposContas * (100 - percentual) / 100));
  const proximo = Math.min(meta, Math.floor(aposContas * percentual / 100), aposContas - pedidos);
  // Uma semana ruim não desfaz a proteção já registrada.
  return Math.max(atual, proximo);
}