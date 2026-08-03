import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, devolucoesTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/devolucoes", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(devolucoesTable)
    .orderBy(sql`${devolucoesTable.createdAt} desc`);
  res.json(rows);
});

router.delete("/devolucoes/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }
  const [deleted] = await db
    .delete(devolucoesTable)
    .where(eq(devolucoesTable.id, id))
    .returning();
  if (!deleted) { res.status(404).json({ error: "Devolução não encontrada" }); return; }
  res.status(204).send();
});

export default router;
