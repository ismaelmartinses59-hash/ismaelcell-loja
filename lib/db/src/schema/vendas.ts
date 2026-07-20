import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const vendasTable = pgTable("vendas", {
  id: serial("id").primaryKey(),
  pecaId: integer("peca_id").notNull(),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  valor: text("valor").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Venda = typeof vendasTable.$inferSelect;
