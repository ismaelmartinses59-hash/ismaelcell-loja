import app from "./app";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { initPush } from "./lib/push";
import { agendarNotificacoesCaixa } from "./lib/notificacoes-caixa";

async function runStatement(label: string, stmt: Promise<unknown>): Promise<void> {
  try {
    await stmt;
  } catch (err) {
    logger.error({ err, label }, "Schema statement failed — will retry on next boot");
    throw err;
  }
}

async function ensureSchema(): Promise<void> {
  await runStatement("orders", db.execute(sql`
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
  `));
  await runStatement("pecas", db.execute(sql`
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
  `));
  await runStatement("vendas", db.execute(sql`
    CREATE TABLE IF NOT EXISTS vendas (
      id serial PRIMARY KEY,
      peca_id integer NOT NULL,
      modelo text NOT NULL,
      qualidade text NOT NULL,
      valor text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("garantias_peca", db.execute(sql`
    CREATE TABLE IF NOT EXISTS garantias_peca (
      id serial PRIMARY KEY,
      modelo text NOT NULL,
      qualidade text NOT NULL,
      lojista text NOT NULL,
      motivo text NOT NULL,
      status text NOT NULL DEFAULT 'pendente',
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("pecas.valor_custo", db.execute(
    sql`ALTER TABLE pecas ADD COLUMN IF NOT EXISTS valor_custo text NOT NULL DEFAULT ''`,
  ));
  await runStatement("contas_receber", db.execute(sql`
    CREATE TABLE IF NOT EXISTS contas_receber (
      id serial PRIMARY KEY,
      nome text NOT NULL,
      tipo text NOT NULL DEFAULT 'cliente',
      created_at timestamp NOT NULL DEFAULT now(),
      closed_at timestamp
    )
  `));
  await runStatement("contas_receber_itens", db.execute(sql`
    CREATE TABLE IF NOT EXISTS contas_receber_itens (
      id serial PRIMARY KEY,
      conta_id integer NOT NULL,
      venda_id integer,
      modelo text NOT NULL,
      qualidade text NOT NULL,
      valor text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("contas_receber_itens.forma_pagamento", db.execute(sql`
    ALTER TABLE contas_receber_itens ADD COLUMN IF NOT EXISTS forma_pagamento text
  `));
  await runStatement("contas_receber_itens.data_recebimento", db.execute(sql`
    ALTER TABLE contas_receber_itens ADD COLUMN IF NOT EXISTS data_recebimento timestamptz
  `));
  await runStatement("contas_receber_pagamentos", db.execute(sql`
    CREATE TABLE IF NOT EXISTS contas_receber_pagamentos (
      id serial PRIMARY KEY,
      conta_id integer NOT NULL,
      valor text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("contas_receber_pagamentos.forma_pagamento", db.execute(sql`
    ALTER TABLE contas_receber_pagamentos ADD COLUMN IF NOT EXISTS forma_pagamento text
  `));
  await runStatement("caixa", db.execute(sql`
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
  `));
  await runStatement("caixa.pagamento_id", db.execute(
    sql`ALTER TABLE caixa ADD COLUMN IF NOT EXISTS pagamento_id integer`,
  ));
  await runStatement("caixa.forma_pagamento", db.execute(
    sql`ALTER TABLE caixa ADD COLUMN IF NOT EXISTS forma_pagamento text`,
  ));
  await runStatement("caixa.taxa_percent", db.execute(
    sql`ALTER TABLE caixa ADD COLUMN IF NOT EXISTS taxa_percent text`,
  ));
  await runStatement("caixa_sessoes", db.execute(sql`
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
  `));
  await runStatement("caixa_sessoes.valor_contado", db.execute(
    sql`ALTER TABLE caixa_sessoes ADD COLUMN IF NOT EXISTS valor_contado text`,
  ));
  await runStatement("caixa_sessoes.total_cartao", db.execute(
    sql`ALTER TABLE caixa_sessoes ADD COLUMN IF NOT EXISTS total_cartao text`,
  ));
  await runStatement("caixa_sessoes.total_cartao_liquido", db.execute(
    sql`ALTER TABLE caixa_sessoes ADD COLUMN IF NOT EXISTS total_cartao_liquido text`,
  ));
  await runStatement("caixa_sessoes.reaberto", db.execute(
    sql`ALTER TABLE caixa_sessoes ADD COLUMN IF NOT EXISTS reaberto boolean NOT NULL DEFAULT false`,
  ));
  await runStatement("push_subscriptions", db.execute(sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id serial PRIMARY KEY,
      endpoint text NOT NULL UNIQUE,
      p256dh text NOT NULL,
      auth text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("app_config", db.execute(sql`
    CREATE TABLE IF NOT EXISTS app_config (
      key text PRIMARY KEY,
      value text NOT NULL,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("encomendas", db.execute(sql`
    CREATE TABLE IF NOT EXISTS encomendas (
      id serial PRIMARY KEY,
      fornecedor text NOT NULL,
      forma_investimento text NOT NULL DEFAULT 'dinheiro',
      status text NOT NULL DEFAULT 'aguardando',
      saida_caixa_id integer,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  // Garante a coluna mesmo se a tabela foi criada por versão antiga sem ela.
  await runStatement("encomendas.forma_investimento", db.execute(
    sql`ALTER TABLE encomendas ADD COLUMN IF NOT EXISTS forma_investimento text NOT NULL DEFAULT 'dinheiro'`,
  ));
  await runStatement("encomenda_itens", db.execute(sql`
    CREATE TABLE IF NOT EXISTS encomenda_itens (
      id serial PRIMARY KEY,
      encomenda_id integer NOT NULL,
      modelo text NOT NULL,
      qualidade text NOT NULL,
      quantidade integer NOT NULL,
      qtd_recebida integer NOT NULL DEFAULT 0,
      valor_custo text NOT NULL DEFAULT '',
      valor_cliente text NOT NULL,
      valor_lojista text NOT NULL,
      status text NOT NULL DEFAULT 'aguardando',
      reembolso_forma text,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  await runStatement("pecas_espera", db.execute(sql`
    CREATE TABLE IF NOT EXISTS pecas_espera (
      id serial PRIMARY KEY,
      peca_id integer NOT NULL,
      modelo text NOT NULL,
      qualidade text NOT NULL,
      valor text NOT NULL,
      setor text NOT NULL DEFAULT 'cliente',
      status text NOT NULL DEFAULT 'aguardando',
      observacao text NOT NULL DEFAULT '',
      created_at timestamp NOT NULL DEFAULT now()
    )
  `));
  logger.info("Schema check ok");
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

ensureSchema()
  .then(async () => {
    await initPush();
    agendarNotificacoesCaixa();
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "ensureSchema falhou — reiniciando processo para tentar novamente");
    process.exit(1);
  });
