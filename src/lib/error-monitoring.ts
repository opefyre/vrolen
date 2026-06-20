/**
 * VROL-480 — Error monitoring init.
 *
 * Wires global `window.error` + `unhandledrejection` listeners so client
 * errors are observable. When `VITE_SENTRY_DSN` is set, we forward each
 * captured error to Sentry's HTTP envelope endpoint directly (no SDK
 * dependency — keeps the bundle lean). When DSN is empty (the dev
 * default), we log to `console.error` so issues still surface in DevTools.
 *
 * Sentry envelope wire format reference:
 *   https://develop.sentry.dev/sdk/envelopes/
 */

import { env } from "@/config/env";

export interface CapturedEvent {
  readonly message: string;
  readonly stack?: string;
  readonly url?: string;
  readonly userAgent?: string;
  readonly timestampMs: number;
}

function parseDsn(dsn: string): { storeUrl: string; publicKey: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, "");
    if (!publicKey || !projectId) return null;
    const host = `${u.hostname}${u.port ? ":" + u.port : ""}`;
    const storeUrl = `${u.protocol}//${host}/api/${projectId}/envelope/`;
    return { storeUrl, publicKey };
  } catch {
    return null;
  }
}

function sendToSentry(dsn: string, ev: CapturedEvent): void {
  const parsed = parseDsn(dsn);
  if (!parsed) return;
  const eventId = (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))
    .padStart(32, "0")
    .slice(0, 32);
  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    sent_at: new Date(ev.timestampMs).toISOString(),
    dsn,
  });
  const itemHeader = JSON.stringify({ type: "event" });
  const item = JSON.stringify({
    event_id: eventId,
    platform: "javascript",
    timestamp: ev.timestampMs / 1000,
    message: ev.message,
    extra: { stack: ev.stack, url: ev.url, userAgent: ev.userAgent },
  });
  const body = `${envelopeHeader}\n${itemHeader}\n${item}\n`;
  void fetch(parsed.storeUrl, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.publicKey}`,
    },
    keepalive: true,
    mode: "no-cors",
  }).catch(() => {
    // best-effort — error monitoring failing must never break the app.
  });
}

export function captureEvent(ev: CapturedEvent): void {
  const dsn = env.VITE_SENTRY_DSN;
  if (typeof dsn === "string" && dsn.length > 0) {
    sendToSentry(dsn, ev);
  } else {
    // Always log in dev / when no DSN is set so DevTools still surfaces it.
    console.error("[vrolen]", ev.message, ev.stack);
  }
}

export function initErrorMonitoring(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (e) => {
    captureEvent({
      message: e.message,
      stack: e.error instanceof Error ? e.error.stack : undefined,
      url: typeof window.location !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      timestampMs: Date.now(),
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const reason = e.reason as unknown;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Unhandled promise rejection";
    captureEvent({
      message,
      stack: reason instanceof Error ? reason.stack : undefined,
      url: typeof window.location !== "undefined" ? window.location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      timestampMs: Date.now(),
    });
  });
}
