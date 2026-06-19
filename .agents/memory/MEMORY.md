# Memory Index

- [Railway deploy of this monorepo](railway-deploy.md) — single-service setup, pnpm version pin, Hobby plan needed for Postgres, deploy branch is `replit-agent`.
- [Contas a Receber manual items](contas-receber-manual-itens.md) — non-peça debts (services fiado) reuse contas_receber_itens with vendaId=null, qualidade="Serviço".
- [Ismael Cell estoque twin invariant](ismael-cell-estoque-twin.md) — any peça-quantity mutation must mirror the twin (opposite setor, same modelo+qualidade) and keep vendas in sync; valor is pt-BR text.
