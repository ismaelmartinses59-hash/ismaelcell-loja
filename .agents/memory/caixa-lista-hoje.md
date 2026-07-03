---
name: Caixa main list = today only
description: Design rule for the Caixa modal's main movements list vs Histórico drilldown.
---

# Caixa main list shows ONLY today

The Caixa modal's main movements list ("Lançamentos de hoje") shows only the
current São Paulo day, and only while today's caixa can still be reopened. Once
the day is "travado" (session `status==="fechado"` AND (`reaberto===true` OR past
the 20:30 reopen limit)), the main list goes empty and points the user to the
Histórico. Every locked day (including past days) is viewable ONLY by clicking
the day name in "Histórico de fechamentos" (per-day drilldown via
`GET /api/caixa?dia=YYYY-MM-DD`).

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
