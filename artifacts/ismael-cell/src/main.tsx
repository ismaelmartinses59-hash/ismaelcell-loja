import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);

const splash = document.getElementById("splash");
if (splash) {
  requestAnimationFrame(() => {
    setTimeout(() => {
      splash.classList.add("fade-out");
      setTimeout(() => splash.remove(), 450);
    }, 300);
  });
}
