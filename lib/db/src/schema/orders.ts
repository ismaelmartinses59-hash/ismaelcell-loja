import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").notNull().unique(),
  modelo: text("modelo").notNull(),
  linha: text("linha").notNull(),
  servico: text("servico").notNull(),
  valor: text("valor").notNull(),
  tempo: text("tempo").notNull(),
  status: text("status").notNull().default("aguardando"),
  tipo: text("tipo").notNull().default("lojista"),
  nomeCliente: text("nome_cliente"),
  senhaDispo: text("senha_dispo"),
  garantia: text("garantia"),
  dataServico: text("data_servico"),
  dataConclusao: timestamp("data_conclusao"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;
