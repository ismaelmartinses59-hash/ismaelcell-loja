import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, ordersTable } from "@workspace/db";
import { isLegacyCode, isRandomCode, validLegacyTrackingKey } from "../lib/order-tracking";
import { limitPublicStatus } from "../lib/public-status-limit";

const router: IRouter = Router();

// Public repair tracking returns only fields displayed to the customer.
// Never expose order lists, names, passwords, prices, or stock through this route.
router.get("/status/:codigo", limitPublicStatus, async (req, res): Promise<void> => {
  const codigo = req.params.codigo;
  if (typeof codigo !== "string" || (!isRandomCode(codigo) && !isLegacyCode(codigo))) {
    res.status(404).json({ error: "Ordem não encontrada" });
    return;
  }
  if (isLegacyCode(codigo) && !validLegacyTrackingKey(codigo, req.query.chave)) {
    // Old, unsigned URLs cannot reveal status anymore. Staff can issue a
    // signed replacement link without changing the order's internal number.
    res.status(403).json({ error: "Este link antigo precisa ser atualizado. Peça um novo link à loja." });
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
  res.json(order);
});

export default router;