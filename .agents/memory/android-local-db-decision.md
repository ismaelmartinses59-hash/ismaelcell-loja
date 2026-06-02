---
name: Hosting direction for Ismael Cell
description: Evolving decision about where Ismael Cell should be hosted to reduce cost
---

# Hosting direction (Ismael Cell)

The owner wants to reduce recurring hosting cost. We explored several paths:

1. Offline Android app / offline web PWA (on-device DB, R$0, no provider) — was
   strongly considered because the only feature forcing a server was the public
   client status link (`/status/:codigo`), which the owner says they NEVER use.
2. BUT the owner ultimately confirmed they DO need **multi-device sync** (see the
   same orders on more than one device). Sync requires a central server + DB, so
   **offline is ruled out.**

**Final direction:** Migrate OFF Replit hosting to a cheaper **external all-in-one
provider**, keeping ALL current features. Budget target ~R$20–30/month. Provider
choice was delegated to the agent — **chosen: Railway** (app + managed Postgres in
one project, no sleeping, ~$5/mo Hobby ≈ R$25–30). Deploy method: connect a GitHub
repo to Railway.

**Status:** the single-service standalone setup is IMPLEMENTED and verified locally
(API server now serves the built frontend on one origin; DB tables auto-create on
boot via an idempotent schema check; root has standalone build + start scripts).
Auth is client-side localStorage only (no server session/cookie), and CORS is open,
so cross-origin is not a concern. Remaining work is the actual external deploy
(needs the owner's GitHub + Railway accounts; best finished on the shop computer).

**Recommended architecture (to keep it cheap + simple + avoid cross-domain auth pain):**
- Single web service that serves BOTH the built frontend (Vite static) AND the
  Express API on the same origin → no CORS/cross-domain cookie issues (auth is
  cookie/session based via cookie-parser).
- One managed Postgres (the app uses drizzle-orm + @workspace/db).
- Today the frontend already has a vendored API client copy and `setBaseUrl()` in
  custom-fetch.ts supports pointing at a remote API, but same-origin single-service
  is simpler.

**Why:** hosting cost comes from an always-on server + always-on DB, not from the
static frontend. Sync forces a central server, so the cheapest stable option is one
small web service + a small managed Postgres on one provider.

**Logistics / blockers:**
- The external provider account is the USER's; agent cannot create accounts or pay.
- Owner is on an iPhone, prefers phone, but has a computer at the shop. The deploy
  step (create account, paste secrets, publish) is MUCH easier on the shop computer
  — owner may defer to "amanhã". Do the code prep as part of the actual deploy
  session so the running Replit app stays stable until then.
- Owner asked to be able to request future feature add/remove changes (paid) — note:
  agent is the Replit AI assistant, takes no personal payment; billing is Replit support.
