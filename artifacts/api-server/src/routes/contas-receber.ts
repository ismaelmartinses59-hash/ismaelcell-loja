import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  contasReceberTable,
  contasReceberItensTable,
  contasReceberPagamentosTable,
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

// Encontra ou cria conta aberta para nome+tipo
async function findOrCreateConta(nome: string, tipo: string): Promise<number> {
  const tipoFinal = tipo === "lojista" ? "lojista" : "cliente";
  const nomeNorm = nome.trim();
  const [existente] = await db
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
  const [novo] = await db
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
  await db.insert(contasReceberPagamentosTable).values({ contaId: id, valor });
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
  await db.delete(contasReceberPagamentosTable).where(eq(contasReceberPagamentosTable.id, id));
  // Reabre a conta se estava fechada
  await db
    .update(contasReceberTable)
    .set({ closedAt: null })
    .where(eq(contasReceberTable.id, pag.contaId));
  res.status(204).send();
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
  await db.delete(contasReceberPagamentosTable).where(eq(contasReceberPagamentosTable.contaId, id));
  await db.delete(contasReceberItensTable).where(eq(contasReceberItensTable.contaId, id));
  await db.delete(contasReceberTable).where(eq(contasReceberTable.id, id));
  res.status(204).send();
});

export default router;
