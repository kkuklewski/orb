import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/setup.css";
import "./styles/views.css";
import "./styles/shell.css";
import "./styles/chat.css";

// Same theme as the old page (Settings → Look): its saved choice, else the system's.
const saved = (() => { try { return localStorage.getItem("vd-theme"); } catch { return null; } })();
document.documentElement.dataset.theme = saved === "light" || saved === "dark" ? saved : matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
