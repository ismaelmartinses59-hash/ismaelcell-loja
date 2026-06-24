import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  contasReceberTable,
  contasReceberItensTable,
  contasReceberPagamentosTable,
  caixaTable,
} from "@workspace/db";

const router: IRouter = Router();

function parseValor(s: string): number {
  const n = parseFloat(String(s ?? "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

async function getContaResumo(contaId: number) {
  const [conta] = await db
    .select()
    .from(contasReceberTable)
    .where(eq(contasReceberTable.id, contaId));
  if (!conta) return null;
  const itens = await db
    .select()
    .from(contasReceberItensTable)
    .where(eq(contasReceberItensTable.contaId, contaId))
    .orderBy(sql`${contasReceberItensTable.createdAt} desc`);
  const pagamentos = await db
    .select()
    .from(contasReceberPagamentosTable)
    .where(eq(contasReceberPagamentosTable.contaId, contaId))
    .orderBy(sql`${contasReceberPagamentosTable.createdAt} desc`);
  const totalItens = itens.reduce((a, i) => a + parseValor(i.valor), 0);
  const totalPago = pagamentos.reduce((a, p) => a + parseValor(p.valor), 0);
  const saldo = totalItens - totalPago;
  return { conta, itens, pagamentos, totalItens, totalPago, saldo };
}

// Lista todas as contas com resumo
router.get("/contas-receber", async (_req, res): Promise<void> => {
  const contas = await db
    .select()
    .from(contasReceberTable)
    .orderBy(sql`${contasReceberTable.closedAt} nulls first, ${contasReceberTable.createdAt} desc`);
  const result = await Promise.all(
    contas.map(async (c) => {
      const r = await getContaResumo(c.id);
      return r;
    }),
  );
  res.json(result.filter((r) => r !== null));
});

// Detalhes de uma conta
router.get("/contas-receber/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const r = await getContaResumo(id);
  if (!r) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }
  res.json(r);
});

// Encontra ou cria conta aberta para nome+tipo.
// Aceita um executor opcional (transação) para participar de uma venda atômica.
type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
async function findOrCreateConta(
  nome: string,
  tipo: string,
  executor: DbExecutor = db,
): Promise<number> {
  const tipoFinal = tipo === "lojista" ? "lojista" : "cliente";
  const nomeNorm = nome.trim();
  const [existente] = await executor
    .select()
    .from(contasReceberTable)
    .where(
      and(
        sql`LOWER(TRIM(${contasReceberTable.nome})) = LOWER(${nomeNorm})`,
        eq(contasReceberTable.tipo, tipoFinal),
        isNull(contasReceberTable.closedAt),
      ),
    );
  if (existente) return existente.id;
  const [novo] = await executor
    .insert(contasReceberTable)
    .values({ nome: nomeNorm, tipo: tipoFinal })
    .returning();
  return novo.id;
}

export { findOrCreateConta };

// Registrar pagamento (AV)
router.post("/contas-receber/:id/pagamento", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const valor = String(req.body?.valor ?? "").trim();
  if (!valor || parseValor(valor) <= 0) {
    res.status(400).json({ error: "Valor inválido" });
    return;
  }
  const r = await getContaResumo(id);
  if (!r) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }
  // Registra o pagamento E lança a entrada correspondente no caixa (AV),
  // ligadas por pagamentoId para manterem-se em sincronia ao apagar.
  await db.transaction(async (tx) => {
    const [pag] = await tx
      .insert(contasReceberPagamentosTable)
      .values({ contaId: id, valor })
      .returning();
    await tx.insert(caixaTable).values({
      tipo: "entrada",
      valor,
      motivo: `AV — ${r.conta.nome}`,
      pagamentoId: pag.id,
    });
  });
  // Verifica saldo: se zerou ou ficou negativo, fecha a conta
  const novo = await getContaResumo(id);
  if (novo && novo.saldo <= 0) {
    await db
      .update(contasReceberTable)
      .set({ closedAt: new Date() })
      .where(eq(contasReceberTable.id, id));
  }
  res.json(await getContaResumo(id));
});

// Apagar pagamento
router.delete("/contas-receber/pagamentos/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const [pag] = await db
    .select()
    .from(contasReceberPagamentosTable)
    .where(eq(contasReceberPagamentosTable.id, id));
  if (!pag) {
    res.status(404).json({ error: "Pagamento não encontrado" });
    return;
  }
  await db.transaction(async (tx) => {
    // Remove também a entrada do caixa vinculada a este pagamento (AV).
    await tx.delete(caixaTable).where(eq(caixaTable.pagamentoId, id));
    await tx
      .delete(contasReceberPagamentosTable)
      .where(eq(contasReceberPagamentosTable.id, id));
    // Reabre a conta se estava fechada
    await tx
      .update(contasReceberTable)
      .set({ closedAt: null })
      .where(eq(contasReceberTable.id, pag.contaId));
  });
  res.status(204).send();
});

// Adiciona item manual (ex: serviço) a uma conta existente
router.post("/contas-receber/:id/item", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const descricao = String(req.body?.descricao ?? "").trim();
  const valor = String(req.body?.valor ?? "").trim();
  if (!descricao) {
    res.status(400).json({ error: "Descrição obrigatória" });
    return;
  }
  if (!valor || parseValor(valor) <= 0) {
    res.status(400).json({ error: "Valor inválido" });
    return;
  }
  const [conta] = await db
    .select()
    .from(contasReceberTable)
    .where(eq(contasReceberTable.id, id));
  if (!conta) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }
  await db.insert(contasReceberItensTable).values({
    contaId: id,
    modelo: descricao,
    qualidade: "Serviço",
    valor,
  });
  // Adicionar dívida reabre a conta caso estivesse quitada
  await db
    .update(contasReceberTable)
    .set({ closedAt: null })
    .where(eq(contasReceberTable.id, id));
  res.json(await getContaResumo(id));
});

// Cria (ou reusa) conta por nome+tipo e adiciona um item de serviço (fiado sem peça)
router.post("/contas-receber/novo-servico", async (req, res): Promise<void> => {
  const nome = String(req.body?.nome ?? "").trim();
  const tipo = req.body?.tipo === "lojista" ? "lojista" : "cliente";
  const descricao = String(req.body?.descricao ?? "").trim();
  const valor = String(req.body?.valor ?? "").trim();
  if (!nome) {
    res.status(400).json({ error: "Nome obrigatório" });
    return;
  }
  if (!descricao) {
    res.status(400).json({ error: "Descrição obrigatória" });
    return;
  }
  if (!valor || parseValor(valor) <= 0) {
    res.status(400).json({ error: "Valor inválido" });
    return;
  }
  const contaId = await findOrCreateConta(nome, tipo);
  await db.insert(contasReceberItensTable).values({
    contaId,
    modelo: descricao,
    qualidade: "Serviço",
    valor,
  });
  res.json(await getContaResumo(contaId));
});

// Apagar item da conta
router.delete("/contas-receber/itens/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  const [item] = await db
    .select()
    .from(contasReceberItensTable)
    .where(eq(contasReceberItensTable.id, id));
  if (!item) {
    res.status(404).json({ error: "Item não encontrado" });
    return;
  }
  await db.delete(contasReceberItensTable).where(eq(contasReceberItensTable.id, id));
  res.status(204).send();
});

// Apagar conta inteira
router.delete("/contas-receber/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }
  await db.transaction(async (tx) => {
    // Remove as entradas de AV no caixa ligadas aos pagamentos desta conta.
    await tx.delete(caixaTable).where(
      sql`${caixaTable.pagamentoId} IN (SELECT id FROM ${contasReceberPagamentosTable} WHERE ${contasReceberPagamentosTable.contaId} = ${id})`,
    );
    await tx
      .delete(contasReceberPagamentosTable)
      .where(eq(contasReceberPagamentosTable.contaId, id));
    await tx
      .delete(contasReceberItensTable)
      .where(eq(contasReceberItensTable.contaId, id));
    await tx.delete(contasReceberTable).where(eq(contasReceberTable.id, id));
  });
  res.status(204).send();
});

export default router;
