import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const devolucoesTable = pgTable("devolucoes", {
  id: serial("id").primaryKey(),
  pecaId: integer("peca_id"),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  valor: text("valor"),
  valorCusto: text("valor_custo"),
  fornecedor: text("fornecedor").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Devolucao = typeof devolucoesTable.$inferSelect;
