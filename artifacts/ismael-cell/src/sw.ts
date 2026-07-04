/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// O injectManifest exige que esta referência exista no código, mas NÃO
// fazemos mais precache do app. Era o precache (cache do app shell) que
// servia versões antigas/quebradas mesmo depois de corrigir e publicar.
// Agora o app sempre carrega direto da rede — sem tela branca por cache velho.
// Guardamos a referência de forma "viva" para o injectManifest encontrar o
// ponto de injeção (senão o bundler remove a linha por ser sem efeito).
const __wbManifest = self.__WB_MANIFEST;
console.debug("[sw] build manifest entries:", __wbManifest.length);

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Apaga qualquer cache antigo que possa estar quebrando o app.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Sem handler de "fetch": o navegador vai sempre à rede buscar o app,
// então nunca mais fica preso numa versão quebrada em cache.

interface PushPayload {
  title?: string;
  body?: string;
  tag?: string;
  url?: string;
}

self.addEventListener("push", (event) => {
  let data: PushPayload = {};
  try {
    if (event.data) data = event.data.json();
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Ismael Cell";
  const options: NotificationOptions = {
    body: data.body || "",
    icon: "/pwa-192x192.png",
    badge: "/pwa-192x192.png",
    tag: data.tag || "ismael-cell",
    data: { url: data.url || "/" },
    requireInteraction: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      }),
  );
});
