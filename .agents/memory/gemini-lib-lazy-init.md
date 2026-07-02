---
name: Gemini integration lib crashes non-Replit hosts at import
description: Why @workspace/integrations-gemini-ai must init lazily, or it kills servers on Railway/other hosts.
---

# Gemini integration client must be lazy

`@workspace/integrations-gemini-ai` validates `AI_INTEGRATIONS_GEMINI_BASE_URL` /
`AI_INTEGRATIONS_GEMINI_API_KEY` and constructs the client. Those env vars are
injected by Replit's AI Integrations proxy and DO NOT exist on external hosts
(Railway, etc.).

**The trap:** if that validation/construction runs at *module import time* (top
level of `client.ts` and `image/client.ts`), then merely importing the lib —
which happens at server startup because a route imports it — throws and crashes
the whole process before it can listen. On Railway this shows as endless
"Deployment crashed" (restart loop → 502 on every path), NOT a build failure.
Misleading downstream symptom: the phone login shows "Credenciais inválidas"
because the frontend shows that generic toast for ANY non-ok response incl. 502.

**Rule:** anything gated on Replit-only integration env vars must initialize
LAZILY (validate + construct on first use, e.g. `getAi()` + a Proxy `ai` export),
never at import. Then the server boots everywhere; the AI feature only errors if
actually invoked without the integration.

**Also required:** esbuild marks `@google/*` external, so `@google/genai` must be
a direct dependency of `artifacts/api-server` (not just transitive via the lib)
or runtime fails with ERR_MODULE_NOT_FOUND — a separate crash with the same 502
symptom.

**Dual-mode client:** `getAi()` now supports BOTH hosting modes off env vars:
- Replit proxy mode: `AI_INTEGRATIONS_GEMINI_BASE_URL` + `_API_KEY` set →
  `httpOptions:{apiVersion:"", baseUrl}` (the "" is required so the proxy path
  isn't rewritten).
- Direct Google mode (Railway/external): only `AI_INTEGRATIONS_GEMINI_API_KEY`
  set (a real Google AI Studio key), NO base url → SDK uses its default Google
  endpoint. So to enable AI features on Railway, set only the API key var there;
  do NOT copy the Replit BASE_URL (it points at the Replit-internal proxy).

**Why:** cost the shop hours of downtime; the fix is trivial but the symptom
(login error) points far away from the real cause (import-time throw on a host
missing Replit integration vars).
