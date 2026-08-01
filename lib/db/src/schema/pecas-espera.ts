import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

export const pecasEsperaTable = pgTable("pecas_espera", {
  id: serial("id").primaryKey(),
  pecaId: integer("peca_id").notNull(),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  valor: text("valor").notNull(),
  setor: text("setor").notNull().default("cliente"),
  status: text("status").notNull().default("aguardando"), // aguardando | pago | cancelado
  observacao: text("observacao").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PecaEspera = typeof pecasEsperaTable.$inferSelect;
