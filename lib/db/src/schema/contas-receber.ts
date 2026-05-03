import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const contasReceberTable = pgTable("contas_receber", {
  id: serial("id").primaryKey(),
  nome: text("nome").notNull(),
  tipo: text("tipo").notNull().default("cliente"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const contasReceberItensTable = pgTable("contas_receber_itens", {
  id: serial("id").primaryKey(),
  contaId: integer("conta_id").notNull(),
  vendaId: integer("venda_id"),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  valor: text("valor").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contasReceberPagamentosTable = pgTable("contas_receber_pagamentos", {
  id: serial("id").primaryKey(),
  contaId: integer("conta_id").notNull(),
  valor: text("valor").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ContaReceber = typeof contasReceberTable.$inferSelect;
export type ContaReceberItem = typeof contasReceberItensTable.$inferSelect;
export type ContaReceberPagamento = typeof contasReceberPagamentosTable.$inferSelect;
