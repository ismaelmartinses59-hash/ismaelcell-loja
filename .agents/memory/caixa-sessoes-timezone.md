---
name: Caixa sessões timezone authority
description: How abertura/fechamento de caixa decides "today" and current time across device/server timezones.
---

# Caixa sessões — fuso horário é autoridade do backend

The "fechamento/abertura de caixa" feature must work no matter what timezone the
employee's phone (or the server) is set to. The shop operates in America/Sao_Paulo.

## Rule
- The **backend derives "today"** in America/Sao_Paulo (a `hojeSP()` helper using
  `Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" })` → `YYYY-MM-DD`).
  The abrir/fechar/status-today endpoints NEVER trust a client-sent `data` for
  session identity — they compute the day server-side.
- Daily totals are computed in São Paulo too (`(created_at AT TIME ZONE
  'America/Sao_Paulo')::date = data`), so session day and totals always agree.
- The **frontend overlay** still needs a clock to decide *when* to block
  (open hour, close hour, day-of-week). It computes São Paulo wall-clock via
  `new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))` and
  reads `.getDay()/.getHours()/.getMinutes()` off that. Passing an explicit
  `timeZone` makes this correct **regardless of the device timezone**.
- Stored timestamps (abertura_at/fechamento_at) are rendered with
  `toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", ... })`, not the
  raw `new Date(...)` local format.

**Why:** the original build trusted device local time and a client-sent `data`,
so a phone with a wrong/changed timezone could open/close the wrong day's session
or block at the wrong time. Architect flagged it; centralizing the date on the
backend and computing SP wall-clock explicitly on the client removes the class of bug.

**How to apply:** any new caixa-session logic (or similar day-scoped/blocking
feature) must derive the business day server-side in São Paulo and format/compare
times with an explicit `timeZone`, never bare `new Date()` device-local fields.
