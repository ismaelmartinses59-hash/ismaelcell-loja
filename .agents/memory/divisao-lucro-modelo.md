---
name: Divisão de lucro (caixa fechamento)
description: Business rules for how the daily profit split is computed on the caixa closing screen.
---

# Divisão de lucro — modelo de cálculo

Shown on the caixa fechamento screen (today's "Caixa fechado" card + histórico day-detail).
Endpoint `GET /api/financeiro/divisao?dia=`; editable settings in `PUT/GET /api/financeiro/config`
(persisted in `app_config`, keys `fin_*`, reusing that already-ensured table — no migration).

## Formula (user-confirmed)
- **lucroBruto** = for each caixa `entrada` of the day: `(valor − peça.valorCusto)` when the entrada
  has a `pecaId`, else the **full valor** (serviço/mão de obra = lucro cheio).
- **salario** = lucroBruto × (percentual, default 30%).
- **despesasDia** = (aluguel + energia + internet + água) ÷ diasTrabalhados (default 24).
- **reinvestimento** = lucroBruto − salario − despesasDia.

**Why:** owner wanted a simple daily "quanto é meu salário / quanto reinveste" split. Cost comes
from the peça's own `valorCusto`, NOT from caixa saídas (saídas are inventory purchases already
captured via custo — subtracting both would double-count).

## Known caveats (by design, don't "fix" without asking the owner)
- **AV/fiado payments** (caixa entrada with `pagamentoId`, `pecaId` null) count as **full profit**.
  Overstates margin for fiado peça sales, but matches the confirmed rule.
- **Orphaned pecaId** (peça deleted → leftJoin custo null) → cost treated as 0 (full profit for that item).
- Negative reinvestimento on a no-sales day is correct (fixed daily costs against zero profit).
