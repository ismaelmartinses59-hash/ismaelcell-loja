import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

// Encomenda = uma compra de peças que ainda NÃO chegou (está a caminho do
// fornecedor). O funcionário confirma a chegada depois; só nesse momento a
// SAÍDA é lançada no caixa (datada no dia da compra = created_at).
export const encomendasTable = pgTable("encomendas", {
  id: serial("id").primaryKey(),
  fornecedor: text("fornecedor").notNull(),
  // Como o custo foi/será pago (dinheiro | pix) — usado ao lançar a saída.
  formaInvestimento: text("forma_investimento").notNull().default("dinheiro"),
  // aguardando | recebida | cancelada
  status: text("status").notNull().default("aguardando"),
  // id da linha de caixa (saída) — preenchido UMA vez na 1ª confirmação de
  // chegada, pra não lançar a saída em dobro.
  saidaCaixaId: integer("saida_caixa_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const encomendaItensTable = pgTable("encomenda_itens", {
  id: serial("id").primaryKey(),
  encomendaId: integer("encomenda_id").notNull(),
  modelo: text("modelo").notNull(),
  qualidade: text("qualidade").notNull(),
  quantidade: integer("quantidade").notNull(),
  qtdRecebida: integer("qtd_recebida").notNull().default(0),
  valorCusto: text("valor_custo").notNull().default(""),
  valorCliente: text("valor_cliente").notNull(),
  valorLojista: text("valor_lojista").notNull(),
  // aguardando | recebido | cancelado
  status: text("status").notNull().default("aguardando"),
  // dinheiro | pix — forma do reembolso quando o item é cancelado.
  reembolsoForma: text("reembolso_forma"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type Encomenda = typeof encomendasTable.$inferSelect;
export type EncomendaItem = typeof encomendaItensTable.$inferSelect;
