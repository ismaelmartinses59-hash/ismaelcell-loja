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