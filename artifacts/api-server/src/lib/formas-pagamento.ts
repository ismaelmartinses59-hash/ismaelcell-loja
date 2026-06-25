/**
 * Formas de pagamento e taxas da maquininha (cartão).
 *
 * Regra de negócio: a taxa é DESCONTADA do que a loja recebe — o cliente paga
 * o valor cheio e a maquininha retém a taxa. Portanto o líquido recebido é
 * `valor * (1 - taxa/100)`.
 */

export type FormaPagamento =
  | "dinheiro"
  | "pix"
  | "debito"
  | "credito_1x"
  | "credito_2x"
  | "credito_3x";

/** Taxa (%) por forma de pagamento. PIX não tem taxa (cai direto na conta). */
export const TAXAS: Record<FormaPagamento, number> = {
  dinheiro: 0,
  pix: 0,
  debito: 1.69,
  credito_1x: 3.49,
  credito_2x: 6.59,
  credito_3x: 7.15,
};

/** Rótulo legível por forma de pagamento. */
export const LABELS: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  pix: "PIX",
  debito: "Cartão débito",
  credito_1x: "Cartão crédito 1x",
  credito_2x: "Cartão crédito 2x",
  credito_3x: "Cartão crédito 3x",
};

export const FORMAS_VALIDAS: FormaPagamento[] = Object.keys(
  TAXAS,
) as FormaPagamento[];

/** Normaliza um valor arbitrário para uma FormaPagamento válida (ou null). */
export function normalizeForma(raw: unknown): FormaPagamento | null {
  const s = String(raw ?? "").trim();
  return (FORMAS_VALIDAS as string[]).includes(s)
    ? (s as FormaPagamento)
    : null;
}

/** True se a forma for um cartão (débito ou crédito). Dinheiro e PIX não são
 * cartão: ambos vão pra gaveta e não têm taxa. */
export function isCartao(f: FormaPagamento | null | undefined): boolean {
  return f != null && f !== "dinheiro" && f !== "pix";
}

/** Taxa (%) da forma; 0 se não houver. */
export function taxaFor(f: FormaPagamento | null | undefined): number {
  return f ? (TAXAS[f] ?? 0) : 0;
}

/** Valor líquido (o que a loja recebe) após descontar a taxa do cartão. */
export function liquido(valorBruto: number, f: FormaPagamento | null): number {
  const taxa = taxaFor(f);
  return valorBruto * (1 - taxa / 100);
}
