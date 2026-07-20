import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { getPublicKey, isPushReady, sendToEndpoint } from "../lib/push.js";

const router: IRouter = Router();

// Chave pública VAPID que o frontend usa para se inscrever.
router.get("/push/vapid-public-key", (_req, res): void => {
  const key = getPublicKey();
  if (!key) {
    res.status(503).json({ error: "Notificações indisponíveis" });
    return;
  }
  res.json({ publicKey: key });
});

// Salva (ou atualiza) uma inscrição de push do aparelho.
router.post("/push/subscribe", async (req, res): Promise<void> => {
  const sub = req.body;
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: "Inscrição inválida" });
    return;
  }
  await db
    .insert(pushSubscriptionsTable)
    .values({ endpoint, p256dh, auth })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { p256dh, auth },
    });
  res.json({ ok: true });
});

// Remove a inscrição (ao desativar os avisos no aparelho).
router.post("/push/unsubscribe", async (req, res): Promise<void> => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) {
    res.status(400).json({ error: "endpoint obrigatório" });
    return;
  }
  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  res.json({ ok: true });
});

// Envia uma notificação de confirmação SOMENTE para o aparelho que acabou de
// se inscrever (endpoint no corpo). Não faz broadcast.
router.post("/push/test", async (req, res): Promise<void> => {
  if (!isPushReady()) {
    res.status(503).json({ error: "Notificações indisponíveis" });
    return;
  }
  const endpoint = req.body?.endpoint;
  if (!endpoint) {
    res.status(400).json({ error: "endpoint obrigatório" });
    return;
  }
  const r = await sendToEndpoint(endpoint, {
    title: "Ismael Cell ✅",
    body: "Notificações ativadas! Você vai receber os avisos de abrir e fechar o caixa.",
    tag: "teste",
    url: "/",
  });
  res.json(r);
});

export default router;
