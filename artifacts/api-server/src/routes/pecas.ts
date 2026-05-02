import { Router, type IRouter } from "express";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { db, pecasTable, vendasTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/pecas", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  const setor = (req.query.setor as string) || "lojista";
  const conditions = [eq(pecasTable.setor, setor)];
  if (search) {
    const s = or(
      ilike(pecasTable.modelo, `%${search}%`),
      ilike(pecasTable.qualidade, `%${search}%`),
    );
    if (s) conditions.push(s);
  }
  const rows = await db
    .select()
    .from(pecasTable)
    .where(and(...conditions))
    .orderBy(sql`${pecasTable.modelo} asc`);
  res.json(rows);
});

router.post("/pecas", async (req, res): Promise<void> => {
  const { modelo, qualidade, valor, valorCusto, quantidade, setor } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const setorFinal = setor === "cliente" ? "cliente" : "lojista";
  const [peca] = await db
    .insert(pecasTable)
    .values({
      modelo: String(modelo),
      qualidade: String(qualidade),
      valor: String(valor),
      valorCusto: valorCusto != null ? String(valorCusto) : "",
      quantidade: parseInt(quantidade) || 0,
      setor: setorFinal,
    })
    .returning();
  res.status(201).json(peca);
});

router.put("/pecas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { modelo, qualidade, valor, valorCusto, quantidade } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const updates: Record<string, unknown> = {
    modelo: String(modelo),
    qualidade: String(qualidade),
    valor: String(valor),
    quantidade: parseInt(quantidade) || 0,
  };
  if (valorCusto !== undefined) updates.valorCusto = String(valorCusto);
  const [peca] = await db
    .update(pecasTable)
    .set(updates)
    .where(eq(pecasTable.id, id))
    .returning();
  if (!peca) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  res.json(peca);
});

router.post("/pecas/:id/vender", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [atual] = await db.select().from(pecasTable).where(eq(pecasTable.id, id));
  if (!atual) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  if (atual.quantidade <= 0) { res.status(400).json({ error: "Sem estoque disponível" }); return; }
  const [peca] = await db
    .update(pecasTable)
    .set({ quantidade: atual.quantidade - 1 })
    .where(eq(pecasTable.id, id))
    .returning();
  await db.insert(vendasTable).values({
    pecaId: id,
    modelo: atual.modelo,
    qualidade: atual.qualidade,
    valor: atual.valor,
  });
  // Estoque compartilhado: decrementa também a peça gêmea no outro setor
  const outroSetor = atual.setor === "cliente" ? "lojista" : "cliente";
  const gemeas = await db
    .select()
    .from(pecasTable)
    .where(
      and(
        eq(pecasTable.setor, outroSetor),
        eq(pecasTable.modelo, atual.modelo),
        eq(pecasTable.qualidade, atual.qualidade),
      ),
    );
  for (const g of gemeas) {
    if (g.quantidade > 0) {
      await db
        .update(pecasTable)
        .set({ quantidade: g.quantidade - 1 })
        .where(eq(pecasTable.id, g.id));
    }
  }
  res.json(peca);
});

router.delete("/pecas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [deleted] = await db.delete(pecasTable).where(eq(pecasTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Peça não encontrada" }); return; }
  res.status(204).send();
});

export default router;
