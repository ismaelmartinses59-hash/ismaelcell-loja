---
name: Formas de pagamento — PIX vs cartão classification
description: How payment forms are classified in Ismael Cell (gaveta vs cartão) and the non-obvious business rules behind it.
---

# Formas de pagamento (Ismael Cell)

The shop owner confirmed these rules:

- **PIX has NO taxa and counts in the gaveta exactly like cash (dinheiro).** It settles instantly into the account, so it is treated as cash for the cash-drawer (gaveta) totals — NOT as a card.
- **Cartão (débito / crédito 1x/2x/3x) machine fee is the shop's loss.** The customer/debtor always pays/owes the GROSS amount; the maquininha fee is deducted only from what the shop receives (líquido). So debt reduction and venda values stay gross; the fee only shows up as líquido in the caixa fechamento.

**Why this matters:** `isCartao(forma)` (backend) / `isCartaoForma(forma)` (frontend mirror) must exclude BOTH `dinheiro` AND `pix`. If pix is ever treated as a card it (a) gets a fee it shouldn't, and (b) drops out of the gaveta totals.

**How to apply:**
- À vista peça sales: only cards auto-create a caixa entrada (`if (!fiado && isCartao(forma) && forma)`). Dinheiro AND pix à vista create NO caixa entry — only the venda is recorded. This is intentional (avoids double counting); keep pix consistent with dinheiro.
- AV (pagamento de fiado, "A Receber"): the pagamento valor that reduces the debt is always gross; the linked caixa entrada carries `formaPagamento` + `taxaPercent` so the fee appears as the shop's loss in fechamento.
- Backend `lib/formas-pagamento.ts` and frontend `src/lib/formas-pagamento.ts` are mirrored — keep TAXAS/labels/isCartao in sync across both.
