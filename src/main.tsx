import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { env } from "@/config/env";
import { initErrorMonitoring } from "@/lib/error-monitoring";
import { initTheme } from "@/lib/theme";
import "./index.css";

// Apply persisted theme to <html> before React mounts so there's no flash of
// the wrong scheme.
initTheme();

// VROL-480 — wire global error + unhandledrejection capture. Forwards to
// Sentry via fetch envelope when VITE_SENTRY_DSN is set; logs to console
// otherwise. No SDK dependency.
initErrorMonitoring();

// VROL-421 — register the service worker after the first paint so it doesn't
// compete with the initial app bootstrap. No-op in dev (HMR + SW don't mix).
if (env.MODE === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Best-effort — failing to register the SW shouldn't break the app.
    });
  });
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found in document.");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
