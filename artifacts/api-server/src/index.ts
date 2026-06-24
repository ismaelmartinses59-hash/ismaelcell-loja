import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function ensureSchema(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS orders (
        id serial PRIMARY KEY,
        codigo text NOT NULL UNIQUE,
        modelo text NOT NULL,
        linha text NOT NULL,
        servico text NOT NULL,
        valor text NOT NULL,
        tempo text NOT NULL,
        status text NOT NULL DEFAULT 'aguardando',
        tipo text NOT NULL DEFAULT 'lojista',
        nome_cliente text,
        senha_dispo text,
        garantia text,
        data_servico text,
        data_conclusao timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pecas (
        id serial PRIMARY KEY,
        modelo text NOT NULL,
        qualidade text NOT NULL,
        valor text NOT NULL,
        valor_custo text NOT NULL DEFAULT '',
        quantidade integer NOT NULL DEFAULT 0,
        setor text NOT NULL DEFAULT 'lojista',
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendas (
        id serial PRIMARY KEY,
        peca_id integer NOT NULL,
        modelo text NOT NULL,
        qualidade text NOT NULL,
        valor text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS garantias_peca (
        id serial PRIMARY KEY,
        modelo text NOT NULL,
        qualidade text NOT NULL,
        lojista text NOT NULL,
        motivo text NOT NULL,
        status text NOT NULL DEFAULT 'pendente',
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`ALTER TABLE pecas ADD COLUMN IF NOT EXISTS valor_custo text NOT NULL DEFAULT ''`,
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contas_receber (
        id serial PRIMARY KEY,
        nome text NOT NULL,
        tipo text NOT NULL DEFAULT 'cliente',
        created_at timestamp NOT NULL DEFAULT now(),
        closed_at timestamp
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contas_receber_itens (
        id serial PRIMARY KEY,
        conta_id integer NOT NULL,
        venda_id integer,
        modelo text NOT NULL,
        qualidade text NOT NULL,
        valor text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS contas_receber_pagamentos (
        id serial PRIMARY KEY,
        conta_id integer NOT NULL,
        valor text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS caixa (
        id serial PRIMARY KEY,
        tipo text NOT NULL,
        valor text NOT NULL,
        motivo text NOT NULL,
        peca_id integer,
        venda_id integer,
        modelo text,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`ALTER TABLE caixa ADD COLUMN IF NOT EXISTS pagamento_id integer`,
    );
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS caixa_sessoes (
        id serial PRIMARY KEY,
        data text NOT NULL UNIQUE,
        status text NOT NULL DEFAULT 'aberto',
        valor_inicial text NOT NULL,
        valor_final text,
        total_entradas text,
        total_saidas text,
        abertura_at timestamp NOT NULL DEFAULT now(),
        fechamento_at timestamp,
        created_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await db.execute(
      sql`ALTER TABLE caixa_sessoes ADD COLUMN IF NOT EXISTS valor_contado text`,
    );
    logger.info("Schema check ok");
  } catch (err) {
    logger.error({ err }, "Schema check failed");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

ensureSchema().finally(() => {
  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
