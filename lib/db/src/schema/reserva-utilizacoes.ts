import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const reservaUtilizacoesTable = pgTable("reserva_utilizacoes", {
  id: serial("id").primaryKey(),
  requestKey: text("request_key").notNull().unique(),
  valorCentavos: integer("valor_centavos").notNull(),
  saldoAnteriorCentavos: integer("saldo_anterior_centavos").notNull(),
  saldoNovoCentavos: integer("saldo_novo_centavos").notNull(),
  tipo: text("tipo").notNull(),
  categoria: text("categoria").notNull(),
  motivo: text("motivo").notNull(),
  descricao: text("descricao"),
  formaPagamento: text("forma_pagamento"),
  caixaId: integer("caixa_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  estornadaAt: timestamp("estornada_at", { withTimezone: true }),
  motivoEstorno: text("motivo_estorno"),
  saldoAnteriorEstornoCentavos: integer("saldo_anterior_estorno_centavos"),
  saldoNovoEstornoCentavos: integer("saldo_novo_estorno_centavos"),
});