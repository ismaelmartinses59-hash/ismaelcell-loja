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

### Important implementation notes
- `useDeleteOrder`, `useEditOrder`, `useReactivateOrder` are manually appended to `lib/api-client-react/src/generated/api.ts` — do NOT regenerate blindly
- `EditOrderBody` type and `OrderTipo` const/type are also defined manually in that file
- After editing `api.ts`, run `cd lib/api-client-react && npx tsc --build` to update declarations
- `tipo` column in DB defaults to `"lojista"`; accepted values: `"lojista"` | `"cliente"`

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
