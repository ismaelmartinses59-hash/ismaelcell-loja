---
name: Caixa main list = today only
description: Design rule for the Caixa modal's main movements list vs Histórico drilldown.
---

# Caixa main list shows ONLY today

The Caixa modal's main movements list ("Lançamentos de hoje") shows only the
current São Paulo day, and only while the day is still "live". Once the day is
"travado" the main list goes empty and points the user to the Histórico. The
lock fires when it is **past 20:30 SP regardless of open/closed status**, OR when
the session is `fechado` AND `reaberto===true` (closed a second time, can't
reopen). Being open past 20:30 is enough to lock — the shop owner considers the
day done at 20:30. Every locked day (including today-still-open and past days) is
viewable ONLY by clicking the day name in "Histórico de fechamentos" (per-day
drilldown via `GET /api/caixa?dia=YYYY-MM-DD`); the `/caixa-sessoes/historico`
route returns ALL sessions incl. today's open one (badge "Aberto"), so a locked
open day stays reachable.

**Why:** user (non-technical shop owner) wanted the daily list to stay clean —
one day at a time — with older days archived, not scrolling forever.

**How to apply:**
- The today list MUST come from a dedicated per-day query (`?dia=<hojeSP>`),
  NOT from the period-filtered `useListCaixa` — otherwise picking a custom date
  range that excludes today would wrongly empty the live list.
- The period filter + totals cards ("Resumo do período") are a SEPARATE report
  and intentionally still span older days.
- The lock must react over time without user interaction: a local 30s tick
  recomputes `hojeTravado`/`hojeSP()` so the 20:30 transition and day rollover
  happen on their own while the modal is open.
- Timezone authority is the backend (São Paulo); client computes SP wall-clock
  with explicit `timeZone`, never device-local.
