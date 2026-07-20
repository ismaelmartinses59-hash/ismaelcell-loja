---
name: AV (fiado payment) ↔ Caixa linkage
description: How debtor-account AV payments mirror into the Caixa ledger and the invariant that keeps them in sync.
---

# AV payments are mirrored into the Caixa

When a debtor (conta a receber) pays an AV (partial payment), the system must record a matching `entrada` in the Caixa ledger so the cash history is complete.

**Mechanism:** `caixa.pagamento_id` (nullable) links a caixa `entrada` to a `contas_receber_pagamentos` row. Motivo is `AV — <nome>`.

**Invariant — these three delete paths must ALL keep caixa + pagamentos in sync (each in a transaction):**
- Register AV → insert pagamento + linked caixa entrada together.
- Delete pagamento (from the conta UI) → delete the linked caixa row, reopen conta.
- Delete the AV entrada (from the Caixa UI) → delete the linked pagamento, reopen conta.
- Delete the whole conta → delete linked caixa rows (`pagamento_id IN (select id ... where conta_id = :id)`) BEFORE deleting pagamentos, else orphan AV entradas inflate Caixa totals.

**Why:** missing any one path leaves the ledger inconsistent (orphan entradas or vanished cash). The conta-delete orphan case was the easy one to forget.

**How to apply:** any new code that creates/deletes contas_receber_pagamentos or caixa rows must consider the linked counterpart. The column is added to prod via `ensureSchema` ALTER (ADD COLUMN IF NOT EXISTS), not drizzle push.

**Frontend cache:** registering/removing an AV must invalidate both `['/api/caixa']` and `['contas-receber']`; the Caixa delete must also invalidate `['contas-receber']`.
