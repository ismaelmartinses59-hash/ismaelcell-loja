---
name: Ismael Cell estoque compartilhado (twin parts)
description: Cross-cutting stock invariant any peça-mutating endpoint must honor
---

# Estoque compartilhado / twin parts invariant

Peças exist in two setores (`cliente`, `lojista`) and stock is meant to be MIRRORED:
a part has a "twin" = the row in the opposite setor with the same `modelo` + `qualidade`
(compared case-insensitively, trimmed).

**Rule:** Any endpoint that mutates peça `quantidade` must apply the SAME change to the
twin. Existing examples: `/pecas/:id/vender`, `/pecas/:id/devolver`, and `/caixa`
(peça-linked entrada). Decrements are guarded with `quantidade > 0`.

**Caixa coupling:** a peça-linked `entrada` in `/caixa` ALSO inserts a row into `vendas`
(so it shows in the Vendas list), and `DELETE /caixa/:id` reverts both the stock (peça +
twin) and the venda. These multi-write flows are wrapped in `db.transaction(...)` for
atomicity; use atomic `sql\`quantidade ± 1\`` updates, not read-then-write.

**Why:** the shop treats both setores as one shared inventory; forgetting the twin makes
the two setores drift out of sync and produces wrong stock counts.

**How to apply:** when adding/editing any route that changes peça quantity or sells/returns
a part, mirror the twin and, if it represents a sale, keep the `vendas` list in sync.
Money `valor` is stored as pt-BR text ("220,00", "1.234,56"); parse with a helper that
strips thousands dots and converts comma→dot, never a bare `parseFloat`.
