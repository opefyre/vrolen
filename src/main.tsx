import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import "@/config/env";
import { initTheme } from "@/lib/theme";
import "./index.css";

// Apply persisted theme to <html> before React mounts so there's no flash of
// the wrong scheme.
initTheme();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found in document.");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
