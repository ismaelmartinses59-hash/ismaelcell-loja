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

### Features
- Login page (POST /api/auth/login — default: `admin@ismaelcell.com` / `ismael123`)
- Service order management: create, list, filter, search, update status
- Supports phone lines: Xiaomi, Samsung, Motorola, iOS
- Auto-fills service options and estimated time based on phone line
- Status workflow: aguardando → em andamento → concluido / problema
- WhatsApp sharing: links to `/status/:codigo` for each order
- Public order status page (no login required)
- Dashboard stats: total, aguardando, em andamento, concluido, problema

### Routes (frontend)
- `/` — Login
- `/ordens` — Main dashboard (requires login)
- `/status/:codigo` — Public order status page

### API Routes
- `POST /api/auth/login` — authenticate
- `GET /api/orders` — list/search orders
- `POST /api/orders` — create order
- `GET /api/orders/:id` — get single order
- `PATCH /api/orders/:id` — update status
- `GET /api/orders/stats` — dashboard stats

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
