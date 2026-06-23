# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Ismael Cell App

A mobile phone repair shop management tool for Ismael Cell assistência técnica.

### DB Fields (orders table)
- `id`, `codigo`, `modelo`, `linha`, `servico`, `valor`, `tempo`, `status`, `tipo`, `createdAt`
- `nome_cliente` (text, nullable) — client name
- `senha_dispo` (text, nullable) — device PIN/password  
- `garantia` (text, nullable) — warranty period
- `data_servico` (text, nullable) — service date (YYYY-MM-DD)

### DB Fields (caixa table)
- `id`, `tipo` (`entrada` | `saida`), `valor` (text), `motivo` (text), `pecaId` (nullable), `vendaId` (nullable), `modelo` (nullable), `createdAt`
- Caixa is ÚNICO/unified (not scoped by `tipo` cliente/lojista). When an `entrada` is linked to a peça, it decrements that peça + its twin and inserts a row into `vendas`; deleting that movimento reverts both stock and the venda (all inside a DB transaction).
- `pagamentoId` (nullable) links a caixa `entrada` to a `contas_receber_pagamentos` row (an AV/pagamento de fiado). When an AV is registered, a caixa entrada (motivo `AV — <nome>`) is created in the same transaction. The link is kept in sync across 4 paths (all transactional): register AV, delete pagamento (conta UI), delete the AV entrada (caixa UI → also reopens the conta), and delete the whole conta (also removes its linked caixa rows). Column added to prod via `ensureSchema` ALTER (ADD COLUMN IF NOT EXISTS).

### Status Values
`aguardando` | `em andamento` | `concluido` | `problema` | `encerrado`

### Notes
- Do NOT regenerate api.ts from api-client-react — it has manually appended hooks
- After editing api-client-react types, run: `cd lib/api-client-react && npx tsc --build`

### Features
- Login page (POST /api/auth/login — credentials from ADMIN_EMAIL/ADMIN_PASSWORD env secrets)
- Service order management: create, list, filter, search, update status
- **Cliente/Lojista dual-mode**: Tab switcher in header; all orders, stats, and forms are scoped to the selected `tipo`
- Supports phone lines: Xiaomi, Samsung, Motorola, iOS
- Auto-fills service options and estimated time based on phone line
- Status workflow: aguardando → em andamento → concluido / problema
- Inline edit on each order card (PUT /api/orders/:id)
- Delete with confirmation (DELETE /api/orders/:id)
- Reativar: re-opens concluded orders with a new OS code (POST /api/orders/:id/reactivate)
- WhatsApp sharing: links to `/status/:codigo` for each order
- Public order status page (no login required)
- Dashboard stats: total, aguardando, em andamento, concluido, problema (filtered by tipo)
- **Fechamento/Abertura de Caixa** (caixa_sessoes): overlay bloqueante (tela cheia) que lembra o funcionário de abrir (8h) e fechar (17h seg–sex, 13h sábado; domingo SEM bloqueio) o caixa. Abrir registra o valor inicial (troco); fechar calcula totalEntradas/totalSaídas do dia e o valorFinal (= inicial + entradas − saídas). 1 sessão por dia. No topo do Caixa modal há um resumo "Caixa de hoje" (status aberto/fechado, hora que abriu/fechou, troco inicial, entrou hoje, saiu hoje, "em caixa agora") via GET /caixa-sessoes (sessão do dia em SP); abaixo, histórico detalhado (data, abriu/fechou, valores) numa seção retrátil. **Fuso horário é AUTORIDADE DO BACKEND**: o servidor deriva "hoje" em America/Sao_Paulo (`hojeSP()`), nunca confia na `data` enviada pelo cliente para abrir/fechar/status; o overlay calcula a hora atual SP via `toLocaleString("en-US",{timeZone:"America/Sao_Paulo"})` (ignora o fuso do aparelho). Horas de abertura/fechamento exibidas com `toLocaleTimeString({timeZone:"America/Sao_Paulo"})`. Tabela criada na prod via `ensureSchema` CREATE TABLE IF NOT EXISTS. Usa raw fetch + react-query (não toca em api.ts gerado).
- **Caixa** (cash register/ledger): unified entradas/saídas with required motivo; period filters (7/15/30 days + custom date range); shows totalEntradas, totalSaidas, saldo. An entrada can be linked to a peça (autocomplete with stock qty) which baixa o estoque (peça + gêmea) and registers a venda; delete reverts both.
- **A Receber — sugestão de nota única**: ao digitar o nome do devedor (form de serviço fiado e diálogo FIADO de peça), o app detecta uma conta aberta com nome igual (aviso verde "vai somar na conta") ou parecido (botão âmbar para usar a conta existente) para manter tudo numa nota só. Quando há match exato, o frontend envia o `conta.nome` canônico para garantir o merge no backend (`findOrCreateConta` só casa por `LOWER(TRIM)`).
- **A Receber — compartilhar no WhatsApp como IMAGEM**: botão por conta gera uma imagem "EXTRATO DE DÉBITO" (marca ISMAEL CELL) e abre o compartilhamento nativo (preview → `navigator.share({files})` → download fallback). A seção "Produtos e Serviços" é DINÂMICA: 1 linha por item (ordenado oldest-first), imagem cresce de altura sozinha. Quando há pagamentos, desenha também a seção verde "PAGAMENTOS (AV)" (1 linha por AV) e, no bloco do total, o resumo "Total dos itens • Pago (AV)". Total destacado = `saldo` devedor. `generateExtratoBlob` recebe `pagamentos`, `totalItens`, `totalPago` além de `nome`/`saldo`/`itens`. Reaproveita a mesma infra de share das peças (`sharePreview`/`generatingShare`/`confirmShare`). Número do rodapé fixo conforme template (89 98144-8787).
  - **IMPORTANTE — o extrato é DESENHADO pixel a pixel num Canvas 2D**, em `src/lib/extrato-image.ts` (`generateExtratoBlob({nome, saldo, itens}) → Blob`), NÃO via html2canvas. Motivo: html2canvas renderiza TORTO no Safari do iPhone (texto/ícones desalinhados, labels cortadas) por mais que o layout esteja certo — testado com flex, table-cell e absolute, todos quebram no iOS. Canvas 2D é determinístico, sai idêntico em qualquer aparelho. Os cards de PEÇA (cliente/lojista) ainda usam html2canvas (`handleShare`/`shareRef`) e funcionam — só o extrato migrou pra Canvas 2D.

### Routes (frontend)
- `/` — Login
- `/ordens` — Main dashboard (requires login)
- `/status/:codigo` — Public order status page

### API Routes
- `POST /api/auth/login` — authenticate
- `GET /api/orders?tipo=lojista|cliente` — list/search orders filtered by tipo
- `POST /api/orders` — create order (accepts `tipo` field)
- `GET /api/orders/:id` — get single order
- `PATCH /api/orders/:id` — update status
- `PUT /api/orders/:id` — inline edit order fields
- `DELETE /api/orders/:id` — delete order
- `POST /api/orders/:id/reactivate` — reactivate concluded order
- `GET /api/orders/stats?tipo=lojista|cliente` — dashboard stats filtered by tipo
- `POST /api/contas-receber/:id/item` — add a manual item/service (`descricao`, `valor`) to an existing debtor account; reopens it if it was quitada
- `POST /api/contas-receber/novo-servico` — create/reuse a debtor account by `nome`+`tipo` and add a manual service item (`descricao`, `valor`) — fiado without selling a peça
- `GET /api/caixa?periodo=7|15|30|365` or `?inicio=YYYY-MM-DD&fim=YYYY-MM-DD` — movimentos + totalEntradas + totalSaidas + saldo
- `POST /api/caixa` — create entrada/saida (`tipo`, `valor`, `motivo`, optional `pecaId` to baixa estoque + create venda)
- `DELETE /api/caixa/:id` — delete movimento (reverts venda + stock if `vendaId` present)

### Important implementation notes
- `useDeleteOrder`, `useEditOrder`, `useReactivateOrder` are manually appended to `lib/api-client-react/src/generated/api.ts` — do NOT regenerate blindly
- `EditOrderBody` type and `OrderTipo` const/type are also defined manually in that file
- After editing `api.ts`, run `cd lib/api-client-react && npx tsc --build` to update declarations
- `tipo` column in DB defaults to `"lojista"`; accepted values: `"lojista"` | `"cliente"`
- **Vendored API client for external hosting**: `artifacts/ismael-cell/src/api-client/` is a COPY of `lib/api-client-react/src/` so the frontend builds self-contained on Vercel/etc (no pnpm workspace needed). Vite aliases `@workspace/api-client-react` → this copy. If you edit `lib/api-client-react/src/generated/api.ts` (manual hooks), re-copy the files into `src/api-client/` or the deployed frontend will be stale.

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
