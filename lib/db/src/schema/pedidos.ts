import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

// Lista de compras planejadas. Só vira estoque quando convertida em encomenda
// e a chegada da encomenda é confirmada.
export const pedidosTable = pgTable("pedidos", {
  id: serial("id").primaryKey(),
  modelo: text("modelo").notNull(),
  quantidade: integer("quantidade").notNull().default(1),
  setor: text("setor"),
  qualidade: text("qualidade").notNull().default(""),
  observacao: text("observacao").notNull().default(""),
  status: text("status").notNull().default("pendente"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Pedido = typeof pedidosTable.$inferSelect;