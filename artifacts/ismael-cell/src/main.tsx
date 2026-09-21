import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const CACHE_RESET_VERSION = "caixa-scroll-fix-3";
if (import.meta.env.PROD && typeof window !== "undefined") {
  const resetCache = window.localStorage.getItem("ismael-cell-cache-reset");
  if (resetCache !== CACHE_RESET_VERSION) {
    window.localStorage.setItem("ismael-cell-cache-reset", CACHE_RESET_VERSION);
    void Promise.all([
      navigator.serviceWorker?.getRegistrations().then((registrations) =>
        Promise.all(registrations.map((registration) => registration.unregister())),
      ),
      window.caches?.keys().then((keys) =>
        Promise.all(keys.map((key) => window.caches.delete(key))),
      ),
    ]).then(() => window.location.reload());
  }
}

if (import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onNeedRefresh() {
        window.location.reload();
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        setInterval(() => {
          registration.update().catch(() => {});
        }, 60 * 1000);
      },
    });
  }).catch(() => {});
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

requestAnimationFrame(() => {
  setTimeout(() => {
    const hideSplash = (window as any).__hideSplash;
    if (typeof hideSplash === "function") {
      hideSplash();
    } else {
      const splash = document.getElementById("splash");
      if (splash) {
        splash.classList.add("fade-out");
        setTimeout(() => splash.remove(), 450);
      }
    }
  }, 300);
});
