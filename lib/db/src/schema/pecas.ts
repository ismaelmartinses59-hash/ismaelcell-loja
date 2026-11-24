import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const pecasTable = pgTable("pecas", {
  id: serial("id").primaryKey(),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  valor: text("valor").notNull(),
  valorCusto: text("valor_custo").notNull().default(""),
  quantidade: integer("quantidade").notNull().default(0),
  setor: text("setor").notNull().default("lojista"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pecasAliasesTable = pgTable("pecas_aliases", {
  id: serial("id").primaryKey(),
  aliasModelo: text("alias_modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  pecaId: integer("peca_id").notNull(),
  gemeaId: integer("gemea_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Peca = typeof pecasTable.$inferSelect;
export type InsertPeca = typeof pecasTable.$inferInsert;
