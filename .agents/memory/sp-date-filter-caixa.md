---
name: São Paulo date filter on caixa.created_at
description: How to correctly filter caixa rows by a São Paulo calendar date when created_at is a naive UTC timestamp.
---

`caixa.created_at` (and similar columns) are Drizzle `timestamp("...")` — i.e.
`timestamp WITHOUT time zone`, storing the instant in **UTC**.

To match rows against a São Paulo calendar `date`, you MUST double-convert:

```sql
(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date = :data::date
```

- First `AT TIME ZONE 'UTC'` reinterprets the naive value as UTC → `timestamptz`.
- Second `AT TIME ZONE 'America/Sao_Paulo'` converts that instant to SP
  wall-clock → naive `timestamp`. Then `::date` gives the SP calendar day.

**Why:** A single `created_at AT TIME ZONE 'America/Sao_Paulo'` treats the naive
UTC value as if it were SP-local and shifts it the wrong way — late-day UTC rows
(evening UTC = afternoon SP) landed on the next day and silently dropped out of
"today" totals (caixa-sessoes showed 0 cartão/entradas despite rows existing).

**How to apply:** Any "totals for a São Paulo day" query over a UTC `timestamp`
column needs the double `AT TIME ZONE` conversion. Bare single-conversion is a bug.
