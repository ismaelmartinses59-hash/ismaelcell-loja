import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const caixaTable = pgTable("caixa", {
  id: serial("id").primaryKey(),
  tipo: text("tipo").notNull(),
  valor: text("valor").notNull(),
  motivo: text("motivo").notNull(),
  pecaId: integer("peca_id"),
  vendaId: integer("venda_id"),
  modelo: text("modelo"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Caixa = typeof caixaTable.$inferSelect;
