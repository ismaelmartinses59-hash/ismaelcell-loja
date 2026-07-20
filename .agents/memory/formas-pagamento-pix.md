---
name: Formas de pagamento — PIX vs cartão classification
description: How payment forms are classified in Ismael Cell (gaveta vs cartão) and the non-obvious business rules behind it.
---

# Formas de pagamento (Ismael Cell)

The shop owner confirmed these rules:

- **PIX has NO taxa, but it does NOT count in the physical gaveta.** It settles into the bank account, so it is tracked as its OWN bucket (`entradasPix`), separate from cash and from cartão. The "em caixa agora" / "esperado na gaveta" (valorFinal) must be `troco + entradasDinheiro − saidasDinheiro` using dinheiro vivo ONLY — PIX and cartão are both excluded from the drawer. (This changed 2026-07: originally PIX was lumped into the gaveta with cash, which inflated the drawer total and confused the owner.)
- **Saídas also carry a forma (dinheiro OR pix only — never cartão).** A PIX saída leaves the bank account, NOT the drawer, so the drawer calc subtracts only `saidasDinheiro`, mirroring entradas. `totaisDoDia` returns `saidasDinheiro`/`saidasPix`; legacy saídas with null forma count as dinheiro. Backend `POST /caixa` rejects cartão on a saída with 400 (frontend never offers it). (Added 2026-07.)
- **Cartão (débito / crédito 1x/2x/3x) machine fee is the shop's loss.** The customer/debtor always pays/owes the GROSS amount; the maquininha fee is deducted only from what the shop receives (líquido). So debt reduction and venda values stay gross; the fee only shows up as líquido in the caixa fechamento.

**Why this matters:** `isCartao(forma)` (backend) / `isCartaoForma(forma)` (frontend mirror) still exclude BOTH `dinheiro` AND `pix` (pix has no fee and is not a card). But for the GAVETA totals, classification is 3-way: dinheiro (+ legacy null forma) → gaveta; pix → `entradasPix`; cartão → its own bruto/líquido. The daily summary (`totaisDoDia` in `caixa-sessoes.ts`) returns `entradasDinheiro`, `entradasPix`, and `cartao[]` separately.

**How to apply:**
- À vista peça sales: EVERY non-fiado sale (dinheiro, pix, AND cartão) must create a caixa entrada, linked to venda+peça so deleting the movimento reverts stock+venda. Dinheiro/pix carry taxaPercent 0; cartão carries its fee. Only fiado creates NO caixa entry (it becomes a conta a receber). **Why:** the owner expects every sale to show up in the caixa histórico regardless of payment form — gating the insert on "is it a card?" silently drops cash/pix sales.
- AV (pagamento de fiado, "A Receber"): the pagamento valor that reduces the debt is always gross; the linked caixa entrada carries `formaPagamento` + `taxaPercent` so the fee appears as the shop's loss in fechamento.
- Backend `lib/formas-pagamento.ts` and frontend `src/lib/formas-pagamento.ts` are mirrored — keep TAXAS/labels/isCartao in sync across both.
