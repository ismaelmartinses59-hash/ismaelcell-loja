---
name: Contas a Receber — manual/service items
description: How non-peça debt items (services sold fiado) are modeled in contas_receber_itens.
---

A debtor-account item (`contas_receber_itens`) does NOT have to come from selling a peça. Manual service items (e.g. "remoção de conta Google" sold fiado) reuse the same table with the **nullable `vendaId` set to null**, `modelo` = the service description, and `qualidade` = the sentinel string `"Serviço"`. No schema change is needed for new arbitrary-value debt lines.

**Why:** the user needs to put arbitrary services (not just parts) onto a customer's running tab. The schema already supported it because `vendaId` was nullable from the start.

**How to apply:** when adding a new kind of non-peça debit to a conta a receber, insert a row with `vendaId: null` and put a human label in `modelo`; keep `qualidade: "Serviço"` so the UI groups/labels it consistently. The "A Receber" tab labels the section "Itens" (not "Peças") because it now mixes parts and services. Two routes back this: `POST /contas-receber/:id/item` (existing account, reopens it if quitada) and `POST /contas-receber/novo-servico` (create/reuse via `findOrCreateConta`, which only matches OPEN accounts — a settled same-name account stays settled and a new one is created).
