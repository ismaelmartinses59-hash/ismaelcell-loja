import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const caixaSessoesTable = pgTable("caixa_sessoes", {
  id: serial("id").primaryKey(),
  data: text("data").notNull().unique(),
  status: text("status").notNull().default("aberto"),
  valorInicial: text("valor_inicial").notNull(),
  valorFinal: text("valor_final"),
  valorContado: text("valor_contado"),
  totalEntradas: text("total_entradas"),
  totalSaidas: text("total_saidas"),
  aberturaAt: timestamp("abertura_at").notNull().defaultNow(),
  fechamentoAt: timestamp("fechamento_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type CaixaSessao = typeof caixaSessoesTable.$inferSelect;
