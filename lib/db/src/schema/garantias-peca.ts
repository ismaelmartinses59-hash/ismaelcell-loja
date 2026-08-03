import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const garantiasPecaTable = pgTable("garantias_peca", {
  id: serial("id").primaryKey(),
  pecaId: integer("peca_id"),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  valor: text("valor"),
  lojista: text("lojista").notNull(),
  motivo: text("motivo").notNull(),
  status: text("status").notNull().default("pendente"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type GarantiaPeca = typeof garantiasPecaTable.$inferSelect;
