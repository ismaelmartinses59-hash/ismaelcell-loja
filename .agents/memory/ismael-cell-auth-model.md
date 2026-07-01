---
name: Ismael Cell auth model
description: The Ismael Cell API has no server-side auth; login is frontend-only. How to treat new endpoints.
---

# Ismael Cell has NO server-side authorization

Every route on the Express API (`artifacts/api-server`) is publicly reachable. The only "auth" is
`POST /api/auth/login`, which just compares against `ADMIN_EMAIL`/`ADMIN_PASSWORD` and gates the
frontend UI. There is no session/token middleware — `/pecas` (create/twin/PUT/DELETE), `/caixa`,
`/contas-receber`, `/orders`, etc. are all open, as is the AI-backed `/pecas/importar-nota`.

**Why:** single-admin shop tool; the owner accepted a frontend-only login. This is the established
threat model, not an oversight in any one feature.

**How to apply:** new endpoints follow the same pattern — do NOT bolt per-endpoint auth onto a
couple of routes, because the frontend sends no token and it would break them while leaving the rest
open. If real protection is ever wanted, it must be an app-wide session/middleware change (a
deliberate, user-approved decision), covering all write routes at once. Note the AI import endpoint
triggers paid Gemini calls, so app-wide auth is the right long-term fix if abuse is a concern.
