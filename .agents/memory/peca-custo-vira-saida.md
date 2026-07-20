---
name: Peça cost → caixa saída (investment)
description: Adding stock auto-registers the cost as a caixa saída, gated opt-in by formaInvestimento (dinheiro/pix).
---

Adding peças to stock registers the cost (custo) as a **saída** in the caixa, so the shop's investment shows in the ledger. The owner picks **dinheiro/pix** next to the custo field to say how they paid.

Rule / conventions (keep consistent):
- The saída is **opt-in**, gated server-side by `formaInvestimentoSaida(raw)` in `pecas.ts`: only `"dinheiro"|"pix"` create a saída; anything else (incl. missing) returns `null` → no saída. This keeps old callers and the **edit** flow (PUT /pecas/:id) from ever creating a saída — only the frontend *add* paths send `formaInvestimento`.
- Saída is inserted **inside the same DB transaction** as the peça insert (all-or-nothing). Applies to all three add paths: `POST /pecas` (wrapped in a tx just for this), `POST /pecas/twin`, `POST /pecas/importar/confirmar`.
- **Twin cost is counted ONCE**: cliente+lojista twins are the same physical stock, so saída = `custo × quantidade` (never ×2). Mirrors the estoque twin invariant.
- **Import = one aggregate saída**: `Σ(custo × qtd)` across all note items, motivo `Compra de peças (nota do fornecedor)`. Manual add motivo: `Compra de estoque: <modelo> (<qtd>x)`.
- Saída forma is dinheiro/pix only (never cartão); `taxaPercent "0"`.

**Why:** owner wanted stock purchases to appear as cash-out with the payment method they used. Opt-in gate avoids double-counting / accidental saídas on edits and other API consumers.

**How to apply:** any new "add stock" path should thread `formaInvestimento` and create the saída in-transaction; never emit a saída on edit/quantity-adjust unless the user explicitly says they paid again.

Frontend: reusable `InvestimentoToggle` in `catalogo-modal.tsx`; shown on add only (`pedirInvestimento` prop) and in the import dialog footer (with live total). Forma threads through handleAddSubmit → previewData → confirmTwin, addMutation, and confirmImport.
