import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, garantiasPecaTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/garantias-peca", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(garantiasPecaTable)
    .orderBy(sql`${garantiasPecaTable.createdAt} desc`);
  res.json(rows);
});

router.post("/garantias-peca", async (req, res): Promise<void> => {
  const { modelo, qualidade, lojista, motivo } = req.body;
  if (!modelo || !qualidade || !lojista || !motivo) {
    res.status(400).json({ error: "Todos os campos são obrigatórios" });
    return;
  }
  const [row] = await db
    .insert(garantiasPecaTable)
    .values({
      modelo: String(modelo),
      qualidade: String(qualidade),
      lojista: String(lojista),
      motivo: String(motivo),
      status: "pendente",
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/garantias-peca/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const { status } = req.body;
  if (!["pendente", "trocado", "recusado"].includes(status)) {
    res.status(400).json({ error: "Status inválido" });
    return;
  }
  const [row] = await db
    .update(garantiasPecaTable)
    .set({ status: String(status) })
    .where(eq(garantiasPecaTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Garantia não encontrada" }); return; }
  res.json(row);
});

router.delete("/garantias-peca/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [deleted] = await db
    .delete(garantiasPecaTable)
    .where(eq(garantiasPecaTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Garantia não encontrada" }); return; }
  res.status(204).send();
});

export default router;
