type MovimentoVenda = {
  id: number;
  tipo: string;
  valor: string;
  motivo: string;
  vendaId?: number | null;
  pagamentoId?: number | null;
  formaPagamento?: string | null;
};

export type GrupoMovimentos<T extends MovimentoVenda> = {
  principal: T;
  partes: T[];
};

// Lançamentos distintos no banco preservam a divisão financeira; apenas a lista
// mostra uma venda à vista com várias formas de pagamento como um registro.
export function agruparMovimentosVenda<T extends MovimentoVenda>(
  movimentos: T[],
): GrupoMovimentos<T>[] {
  const grupos: GrupoMovimentos<T>[] = [];
  const porVenda = new Map<number, GrupoMovimentos<T>>();
  for (const movimento of movimentos) {
    // Pagamentos de contas/fiado podem acontecer em momentos diferentes:
    // não devem ser somados como se fossem uma única venda à vista.
    const vendaId = movimento.tipo === "entrada" && !movimento.pagamentoId
      ? movimento.vendaId
      : null;
    const existente = vendaId != null ? porVenda.get(vendaId) : undefined;
    if (existente) {
      existente.partes.push(movimento);
    } else {
      const grupo = { principal: movimento, partes: [movimento] };
      grupos.push(grupo);
      if (vendaId != null) porVenda.set(vendaId, grupo);
    }
  }
  return grupos;
}

export function tituloVendaAgrupada<T extends MovimentoVenda>(grupo: GrupoMovimentos<T>): string {
  if (grupo.partes.length < 2) return grupo.principal.motivo;
  return grupo.principal.motivo.replace(/\s*\(Misto\s*·[^)]*\)/i, " (Misto)");
}
