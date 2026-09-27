import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";

const router: IRouter = Router();

// Public repair tracking returns only fields displayed to the customer.
// Never expose order lists, names, passwords, prices, or stock through this route.
router.get("/status/:codigo", async (req, res): Promise<void> => {
  const codigo = req.params.codigo;
  if (typeof codigo !== "string" || !/^OS-\d{13}$/.test(codigo)) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }
  const [order] = await db.select({
    codigo: ordersTable.codigo,
    status: ordersTable.status,
    modelo: ordersTable.modelo,
    servico: ordersTable.servico,
    tempo: ordersTable.tempo,
    createdAt: ordersTable.createdAt,
  }).from(ordersTable).where(eq(ordersTable.codigo, codigo)).limit(1);
  if (!order) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(order);
});

export default router;