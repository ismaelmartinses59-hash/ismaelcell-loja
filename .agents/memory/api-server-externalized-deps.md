---
name: Externalized deps must be direct deps of the bundled server
description: Why the esbuild-bundled api-server crashes in prod with ERR_MODULE_NOT_FOUND for a package that works in dev.
---

# esbuild externals need to be DIRECT deps of the api-server

`artifacts/api-server` bundles with esbuild (`build.mjs`), which marks many packages as
`external` (not bundled) — including broad globs like `@google/*`, `@aws-sdk/*`, `sharp`, etc.
An externalized import stays as `import x from "pkg"` in `dist/index.mjs`, so Node must resolve it
from `artifacts/api-server/node_modules/` at runtime.

**Why it breaks:** if the package only arrives *transitively* (e.g. `@google/genai` came in via the
`@workspace/integrations-gemini-ai` lib), pnpm's strict layout puts it under the lib's node_modules,
NOT the api-server's. Dev works (`tsx` follows workspace symlinks through the lib), but the deployed
bundle throws `ERR_MODULE_NOT_FOUND: Cannot find package '@google/genai'` on startup → Railway
healthcheck `/api` returns 500 → deploy fails.

**How to apply:** whenever the api-server (directly or through a workspace lib) uses a package that
matches an `external` entry in `build.mjs`, add that package to the api-server's OWN `dependencies`
in `artifacts/api-server/package.json`. Don't rely on transitive resolution for externalized deps.
Alternative (not preferred): remove it from the external list so esbuild bundles it — only safe for
pure-JS packages without native addons / path traversal.
