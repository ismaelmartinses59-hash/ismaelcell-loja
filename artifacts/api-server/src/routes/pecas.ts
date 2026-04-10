import { Router, type IRouter } from "express";
import { eq, ilike, or, sql } from "drizzle-orm";
import { db, pecasTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/pecas", async (req, res): Promise<void> => {
  const search = req.query.search as string | undefined;
  let query = db.select().from(pecasTable).$dynamic();
  if (search) {
    query = query.where(
      or(
        ilike(pecasTable.modelo, `%${search}%`),
        ilike(pecasTable.qualidade, `%${search}%`),
      )
    );
  }
  const rows = await query.orderBy(sql`${pecasTable.modelo} asc`);
  res.json(rows);
});

router.post("/pecas", async (req, res): Promise<void> => {
  const { modelo, qualidade, valor, quantidade } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const [peca] = await db
    .insert(pecasTable)
    .values({ modelo: String(modelo), qualidade: String(qualidade), valor: String(valor), quantidade: parseInt(quantidade) || 0 })
    .returning();
  res.status(201).json(peca);
});

router.put("/pecas/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { modelo, qualidade, valor, quantidade } = req.body;
  if (!modelo || !qualidade || !valor) {
    res.status(400).json({ error: "modelo, qualidade e valor são obrigatórios" });
    return;
  }
  const [peca] = await db
    .update(pecasTable)
    .set({ modelo: String(modelo), qualidade: String(qualidade), valor: String(valor), quantidade: parseInt(quantidade) || 0 })
    .where(eq(pecasTable.id, id))
    .returning();
  if (!peca) { res.status(404).json({ error: "Peça não encontrada" }); return; }
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
