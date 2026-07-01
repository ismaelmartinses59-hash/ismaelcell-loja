# Memory Index

- [Railway deploy of this monorepo](railway-deploy.md) — single-service setup, pnpm version pin, Hobby plan needed for Postgres, deploy branch is `replit-agent`.
- [RAILWAY_DATABASE_URL is PRODUCTION](railway-db-is-production.md) — that secret is the live prod DB (dev API uses a separate dev DB); never run write/DELETE psql against it.
- [SP-date filter on caixa.createdAt](sp-date-filter-caixa.md) — created_at is `timestamp` (UTC, no tz); to match a São Paulo date use `AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo'` (double conversion).
- [Share-image rendering](html2canvas-layout.md) — html2canvas mis-renders on iOS Safari; the debtor EXTRATO is drawn pixel-by-pixel on Canvas 2D. Peça cards still use html2canvas.
- [Contas a Receber manual items](contas-receber-manual-itens.md) — non-peça debts (services fiado) reuse contas_receber_itens with vendaId=null, qualidade="Serviço".
- [Ismael Cell estoque twin invariant](ismael-cell-estoque-twin.md) — any peça-quantity mutation must mirror the twin (opposite setor, same modelo+qualidade) and keep vendas in sync; valor is pt-BR text.
- [Ismael Cell auth model](ismael-cell-auth-model.md) — API has NO server-side auth; login is frontend-only. Don't add per-endpoint auth; only app-wide middleware (user-approved) makes sense.
- [Formas de pagamento — PIX vs cartão](formas-pagamento-pix.md) — PIX = no taxa, counts in gaveta like cash; cartão fee is shop's loss (debt stays gross); isCartao must exclude dinheiro AND pix; backend/frontend libs mirrored.
- [Web push notifications](push-notifications.md) — VAPID keys live in DB (not env) so Railway works zero-config; confirmation ping must target one device, never broadcast; iOS needs PWA installed.
- [Caixa sessões timezone authority](caixa-sessoes-timezone.md) — day-scoped/blocking caixa logic derives "today" server-side in São Paulo; client computes SP wall-clock with explicit timeZone, never device-local.
- [AV ↔ Caixa linkage](caixa-av-link.md) — fiado AV payments mirror into caixa via `caixa.pagamento_id`; all 4 create/delete paths (incl. delete-whole-conta) must stay in sync or the ledger drifts.
