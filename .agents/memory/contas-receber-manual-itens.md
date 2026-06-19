---
name: Contas a Receber — manual/service items
description: How non-peça debt items (services sold fiado) are modeled in contas_receber_itens.
---

A debtor-account item (`contas_receber_itens`) does NOT have to come from selling a peça. Manual service items (e.g. "remoção de conta Google" sold fiado) reuse the same table with the **nullable `vendaId` set to null**, `modelo` = the service description, and `qualidade` = the sentinel string `"Serviço"`. No schema change is needed for new arbitrary-value debt lines.

**Why:** the user needs to put arbitrary services (not just parts) onto a customer's running tab. The schema already supported it because `vendaId` was nullable from the start.

**How to apply:** when adding a new kind of non-peça debit to a conta a receber, insert a row with `vendaId: null` and put a human label in `modelo`; keep `qualidade: "Serviço"` so the UI groups/labels it consistently. The "A Receber" tab labels the section "Itens" (not "Peças") because it now mixes parts and services. Two routes back this: `POST /contas-receber/:id/item` (existing account, reopens it if quitada) and `POST /contas-receber/novo-servico` (create/reuse via `findOrCreateConta`, which only matches OPEN accounts — a settled same-name account stays settled and a new one is created).

## Name matching: frontend suggestion vs backend merge

The "A Receber" name-suggestion UI (both the novo-serviço form and the FIADO peça dialog) uses an accent/case/inner-space-folding normalizer (`normNome`) plus a fuzzy `nomeSimilar` (substring / first-token / Levenshtein≤2) to suggest an existing OPEN account so all debt stays in one note. But `findOrCreateConta` on the server only merges on `LOWER(TRIM(nome))` — it does NOT fold accents or collapse inner spaces.

**Why:** that mismatch means the UI could promise "vai somar na conta de João" while the backend creates a *separate* account for the variant "Joao" — splitting the debt and defeating the whole "nota só" goal.

**How to apply:** whenever the frontend detects an EXACT open-account match under its looser normalization, submit the account's **canonical stored `conta.nome`** (not the raw typed text) to `novo-servico` / the FIADO sale, so the backend's `LOWER(TRIM)` match is guaranteed to hit. Fuzzy (similar-but-not-exact) matches must NOT auto-merge — the user has to tap the amber suggestion button (which fills the field with the exact stored name) to consent. If you ever make the backend normalization stricter (fold accents/spaces), keep it in lockstep with `normNome` or this guarantee breaks again.
