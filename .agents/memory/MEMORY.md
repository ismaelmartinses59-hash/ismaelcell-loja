# Memory Index

- [Railway deploy of this monorepo](railway-deploy.md) — single-service setup, pnpm version pin, Hobby plan needed for Postgres, deploy branch is `replit-agent`.
- [Share-image rendering](html2canvas-layout.md) — html2canvas mis-renders on iOS Safari; the debtor EXTRATO is drawn pixel-by-pixel on Canvas 2D. Peça cards still use html2canvas.
- [Contas a Receber manual items](contas-receber-manual-itens.md) — non-peça debts (services fiado) reuse contas_receber_itens with vendaId=null, qualidade="Serviço".
- [Ismael Cell estoque twin invariant](ismael-cell-estoque-twin.md) — any peça-quantity mutation must mirror the twin (opposite setor, same modelo+qualidade) and keep vendas in sync; valor is pt-BR text.
- [Caixa sessões timezone authority](caixa-sessoes-timezone.md) — day-scoped/blocking caixa logic derives "today" server-side in São Paulo; client computes SP wall-clock with explicit timeZone, never device-local.
- [AV ↔ Caixa linkage](caixa-av-link.md) — fiado AV payments mirror into caixa via `caixa.pagamento_id`; all 4 create/delete paths (incl. delete-whole-conta) must stay in sync or the ledger drifts.
