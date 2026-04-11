import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db, vendasTable } from "@workspace/db";

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

export default router;
