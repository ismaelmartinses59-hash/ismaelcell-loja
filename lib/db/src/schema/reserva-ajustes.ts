import { integer, pgTable, serial, timestamp } from "drizzle-orm/pg-core";

export const reservaAjustesTable = pgTable("reserva_ajustes", {
  id: serial("id").primaryKey(),
  valorAnterior: integer("valor_anterior").notNull(),
  aumento: integer("aumento").notNull(),
  valorNovo: integer("valor_novo").notNull(),
  entradaNova: integer("entrada_nova").notNull(),
  percentual: integer("percentual").notNull(),
  contasProtegidas: integer("contas_protegidas").notNull(),
  pedidosProtegidos: integer("pedidos_protegidos").notNull(),
  ultimoLancamentoId: integer("ultimo_lancamento_id").notNull().unique("reserva_ajustes_ultimo_lancamento_id_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReservaAjuste = typeof reservaAjustesTable.$inferSelect;