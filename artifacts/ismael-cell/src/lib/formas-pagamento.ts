// Formas de pagamento e taxas da maquininha (espelho do backend, só para
// mostrar a prévia do valor líquido na tela). O cálculo oficial é do servidor.
// Regra: a taxa é descontada do que a loja recebe (cliente paga o valor cheio).

export type FormaCartao = "debito" | "credito_1x" | "credito_2x" | "credito_3x";
export type FormaPagamento = "dinheiro" | FormaCartao;

export const TAXAS_CARTAO: Record<FormaCartao, number> = {
  debito: 1.69,
  credito_1x: 3.49,
  credito_2x: 6.59,
  credito_3x: 7.15,
};

export const LABELS_FORMA: Record<FormaPagamento, string> = {
  dinheiro: "Dinheiro",
  debito: "Cartão débito",
  credito_1x: "Crédito 1x",
  credito_2x: "Crédito 2x",
  credito_3x: "Crédito 3x",
};

/** Valor líquido (o que a loja recebe) após a taxa do cartão. */
export function liquidoCartao(bruto: number, forma: FormaCartao): number {
  return bruto * (1 - TAXAS_CARTAO[forma] / 100);
}
