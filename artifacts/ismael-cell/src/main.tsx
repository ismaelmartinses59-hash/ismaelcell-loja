import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

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
