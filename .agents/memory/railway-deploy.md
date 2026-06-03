---
name: Railway deploy of this monorepo
description: How the Ismael Cell pnpm monorepo is deployed to Railway (single service + Postgres), and the gotchas that wasted time.
---

# Deploying this monorepo to Railway

The app is hosted on Railway (external, off Replit) for ~US$5/mo so the repair shop has multi-device sync. Deploy is from the GitHub repo `ismaelcell-loja`.

## Single service, not per-package
Railway's monorepo auto-detection (Railpack) proposes ONE service PER workspace package (it found ~5). That is wrong for this app — the api-server serves the built frontend on one origin. Configure ONE service:
- **Root Directory:** `/`
- **Build Command:** `pnpm run build:standalone`
- **Start Command:** `pnpm run start:standalone`
- Delete/ignore the extra per-package service cards.

**Why:** single-origin design — `build:standalone` builds the Vite frontend + api-server and copies the SPA into the server's `dist/public`; the server serves both API and SPA. PORT is injected by Railway and the server reads it.

## Deploy branch = `replit-agent`
Replit's Git integration commits/pushes to the `replit-agent` branch (NOT `main`). Railway's "Branch connected to production" must be set to **`replit-agent`** or it deploys empty/stale code. Future code changes go live by pushing `replit-agent` from Replit's Git UI (Sync Changes) → Railway auto-redeploys.

## Pin pnpm version (frozen-lockfile mismatch)
First build failed with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` because Railway used a newer pnpm than the one that generated `pnpm-lock.yaml`. Fix: add `"packageManager": "pnpm@<exact local version>"` to root `package.json` so Railway's builder uses the same pnpm.
**How to apply:** check local `pnpm --version`, set that exact version in the `packageManager` field, push.

## Postgres requires the Hobby plan
Railway free/trial plan throws "Free plan resource provision limit exceeded. Please upgrade" when adding PostgreSQL. Must upgrade to **Hobby (US$5/mo)** to provision a database.

## DB connection
In the app service Variables, set `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (reference to the Postgres service — uses Railway's private network, no SSL config needed). Also set `ADMIN_EMAIL` and `ADMIN_PASSWORD` (the app's login credentials). DB tables auto-create on boot (ensureSchema). The Railway Postgres starts EMPTY — existing Replit data is not carried over automatically.

## Verifying a deploy (from shell)
`curl https://<domain>/` (SPA, title "Ismael Cell"), `/api/healthz` ({"status":"ok"}), `/api/orders?tipo=lojista` (200 + JSON confirms DB works).

## Migrating Replit data → Railway (one-off)
The app stores more than service orders: `pecas` (parts/inventory), `vendas` (sales), plus empty `contas_receber*` and `garantias_peca`. The user thinks of inventory rows ("telas" = phone screens) as the bulk of their data — do NOT assume "orders" is all of it; count every populated table.

**Replit prod vs dev are different databases.** The real customer data lived in the *production* DB, not dev. Read it with `executeSql({ environment: "production" })` (read-only replica) — the dev DB had far fewer rows.

**Bridging the secret gap:** the `code_execution` sandbox can run `executeSql` (reaches Replit prod) but has **no `process.env`** (can't read the Railway URL secret). A `node` script run via the **bash tool** has the secret in its env but can't reach Replit prod. So: in the sandbox, dump prod tables to a JSON file via `SELECT json_agg(t)::text` (output comes back CSV-escaped — strip the `data` header, unwrap outer quotes, replace `""`→`"`, then `JSON.parse`); then run a bash `node` script that reads the file and inserts into Railway.

**Insert details:** preserve `id`s, then fix each sequence with `setval(pg_get_serial_sequence(tb,'id'), MAX(id))`. Guard idempotency by aborting if the Railway table already has rows. `pg` isn't at the workspace root — import it from `node_modules/.pnpm/pg@<ver>/node_modules/pg/lib/index.js`. Railway public URL needs `ssl: { rejectUnauthorized: false }`. Delete the Railway DB URL secret after migrating (it's a live write credential).
