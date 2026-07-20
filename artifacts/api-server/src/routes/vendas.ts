import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, vendasTable, pecasTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/vendas", async (req, res): Promise<void> => {
  const periodo = (req.query.periodo as string) || "dia";

  let intervalo: string;
  if (periodo === "semana") intervalo = "7 days";
  else if (periodo === "mes") intervalo = "30 days";
  else intervalo = "1 day";

  const rows = await db
    .select()
    .from(vendasTable)
    .where(sql`${vendasTable.createdAt} >= now() - interval ${sql.raw(`'${intervalo}'`)}`)
    .orderBy(sql`${vendasTable.createdAt} desc`);

  const total = rows.reduce((acc, v) => {
    const n = parseFloat(v.valor.replace(",", "."));
    return acc + (isNaN(n) ? 0 : n);
  }, 0);

  res.json({ vendas: rows, total, quantidade: rows.length });
});

router.delete("/vendas/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "ID inválido" });
    return;
  }

  const [venda] = await db.select().from(vendasTable).where(eq(vendasTable.id, id));
  if (!venda) {
    res.status(404).json({ error: "Venda não encontrada" });
    return;
  }

  await db.delete(vendasTable).where(eq(vendasTable.id, id));

  if (venda.pecaId) {
    await db
      .update(pecasTable)
      .set({ quantidade: sql`${pecasTable.quantidade} + 1` })
      .where(eq(pecasTable.id, venda.pecaId));
  }

  res.status(204).send();
});

export default router;
