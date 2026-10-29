function normalizarIdentidade(modelo: string): string {
  return modelo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizarQualidade(qualidade: string): string {
  return qualidade
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function chaveModeloCompartilhado(modelo: string): string {
  return normalizarIdentidade(modelo);
}

export function chaveEstoqueCompartilhado(modelo: string, qualidade: string): string {
  return `${chaveModeloCompartilhado(modelo)}::${normalizarQualidade(qualidade)}`;
}

export function mesmaPecaCompartilhada(
  a: { modelo: string; qualidade: string },
  b: { modelo: string; qualidade: string },
): boolean {
  return chaveEstoqueCompartilhado(a.modelo, a.qualidade) ===
    chaveEstoqueCompartilhado(b.modelo, b.qualidade);
}
