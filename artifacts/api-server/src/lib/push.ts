import webpush from "web-push";
import { eq } from "drizzle-orm";
import {
  db,
  appConfigTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

const VAPID_PUBLIC_KEY = "vapid_public_key";
const VAPID_PRIVATE_KEY = "vapid_private_key";
// E-mail de contato exigido pelo protocolo Web Push (mailto). Não precisa ser real.
const VAPID_SUBJECT = "mailto:contato@ismaelcell.app";

let publicKeyCache: string | null = null;
let ready = false;

async function getConfig(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appConfigTable)
    .where(eq(appConfigTable.key, key));
  return row?.value ?? null;
}

async function setConfig(key: string, value: string): Promise<void> {
  await db
    .insert(appConfigTable)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appConfigTable.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Garante que existe um par de chaves VAPID persistido no banco. As chaves são
 * geradas uma única vez (primeira inicialização) e ficam guardadas em app_config,
 * de modo que tanto o ambiente de dev quanto a produção (Railway) funcionam sem
 * precisar configurar variáveis de ambiente manualmente.
 */
export async function initPush(): Promise<void> {
  try {
    let pub = await getConfig(VAPID_PUBLIC_KEY);
    let priv = await getConfig(VAPID_PRIVATE_KEY);
    if (!pub || !priv) {
      const keys = webpush.generateVAPIDKeys();
      // Grava o par inteiro numa única transação para evitar que cold starts
      // concorrentes (várias instâncias) gravem chaves pública/privada
      // desencontradas.
      await db.transaction(async (tx) => {
        const [existingPub] = await tx
          .select()
          .from(appConfigTable)
          .where(eq(appConfigTable.key, VAPID_PUBLIC_KEY));
        const [existingPriv] = await tx
          .select()
          .from(appConfigTable)
          .where(eq(appConfigTable.key, VAPID_PRIVATE_KEY));
        if (existingPub?.value && existingPriv?.value) {
          pub = existingPub.value;
          priv = existingPriv.value;
          return;
        }
        await tx
          .insert(appConfigTable)
          .values({ key: VAPID_PUBLIC_KEY, value: keys.publicKey })
          .onConflictDoUpdate({
            target: appConfigTable.key,
            set: { value: keys.publicKey, updatedAt: new Date() },
          });
        await tx
          .insert(appConfigTable)
          .values({ key: VAPID_PRIVATE_KEY, value: keys.privateKey })
          .onConflictDoUpdate({
            target: appConfigTable.key,
            set: { value: keys.privateKey, updatedAt: new Date() },
          });
        pub = keys.publicKey;
        priv = keys.privateKey;
      });
      logger.info("VAPID keys generated and stored");
    }
    if (!pub || !priv) {
      logger.error("VAPID keys missing after init");
      return;
    }
    webpush.setVapidDetails(VAPID_SUBJECT, pub, priv);
    publicKeyCache = pub;
    ready = true;
  } catch (err) {
    logger.error({ err }, "Failed to initialize web push");
  }
}

export function getPublicKey(): string | null {
  return publicKeyCache;
}

export function isPushReady(): boolean {
  return ready;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

/**
 * Envia uma notificação para todas as inscrições salvas. Inscrições inválidas
 * (410/404) são removidas automaticamente.
 */
export async function sendToAll(payload: PushPayload): Promise<{
  sent: number;
  removed: number;
}> {
  if (!ready) {
    logger.warn("sendToAll called before push ready");
    return { sent: 0, removed: 0 };
  }
  const subs = await db.select().from(pushSubscriptionsTable);
  const data = JSON.stringify(payload);
  let sent = 0;
  let removed = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          data,
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, s.id));
          removed++;
        } else {
          logger.error({ err, endpoint: s.endpoint }, "push send failed");
        }
      }
    }),
  );
  return { sent, removed };
}

/**
 * Envia uma notificação para UMA inscrição específica (pelo endpoint). Usado
 * para o aviso de confirmação logo após o aparelho se inscrever — evita o
 * broadcast para todo mundo. Remove a inscrição se ela estiver inválida.
 */
export async function sendToEndpoint(
  endpoint: string,
  payload: PushPayload,
): Promise<{ sent: number; removed: number }> {
  if (!ready) return { sent: 0, removed: 0 };
  const [s] = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, endpoint));
  if (!s) return { sent: 0, removed: 0 };
  try {
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(payload),
    );
    return { sent: 1, removed: 0 };
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 404 || status === 410) {
      await db
        .delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.id, s.id));
      return { sent: 0, removed: 1 };
    }
    logger.error({ err, endpoint: s.endpoint }, "push send failed");
    return { sent: 0, removed: 0 };
  }
}
