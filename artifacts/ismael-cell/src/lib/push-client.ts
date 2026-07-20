const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type PushStatus =
  | "unsupported"
  | "denied"
  | "subscribed"
  | "unsubscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Estado atual da inscrição neste aparelho. */
export async function getPushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "subscribed" : "unsubscribed";
  } catch {
    return "unsubscribed";
  }
}

/** Pede permissão, inscreve o aparelho e salva no servidor. */
export async function enablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "unsubscribed";

  const reg = await navigator.serviceWorker.ready;

  const keyRes = await fetch(`${BASE}/api/push/vapid-public-key`);
  if (!keyRes.ok) throw new Error("Não foi possível obter a chave de notificação");
  const { publicKey } = await keyRes.json();

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    });
  }

  const res = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error("Não foi possível salvar a inscrição");

  // Dispara um aviso de confirmação SOMENTE para o próprio aparelho.
  fetch(`${BASE}/api/push/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});

  return "subscribed";
}

/** Cancela a inscrição neste aparelho. */
export async function disablePush(): Promise<PushStatus> {
  if (!pushSupported()) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch(`${BASE}/api/push/unsubscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
  return "unsubscribed";
}
