import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

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
