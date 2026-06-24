---
name: RAILWAY_DATABASE_URL is PRODUCTION
description: The RAILWAY_DATABASE_URL secret points at the live Railway production DB, separate from the dev API's database. Never run test/write queries against it.
---

The `RAILWAY_DATABASE_URL` env secret points at the **live production** database
(the real shop data on Railway). The dev API server (`localhost:80` /
`pnpm --filter @workspace/api-server run dev`) connects to a **separate dev
database** with different data. The two are NOT the same — IDs and row contents
differ between them.

**Why:** A `psql "$RAILWAY_DATABASE_URL"` cleanup query can silently mutate real
shop data while you believe you are touching the dev DB. The two databases look
similar enough that this mistake is easy to make and hard to notice.

**How to apply:**
- To test/verify against the running app, ALWAYS go through the dev API
  (`curl localhost:80/api/...`), which uses the dev DB.
- NEVER run write/DELETE queries against `psql "$RAILWAY_DATABASE_URL"`. For
  production reads, use the `database` skill with `environment: "production"`
  (read-only).
- If you must clean dev test data, do it through dev API endpoints, not psql.
