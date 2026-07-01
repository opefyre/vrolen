/**
 * VROL — shared OpenAI key path.
 *
 * The user's default AI experience: no BYO key required. The Vite dev
 * server reads ../openai.txt (workspace root, gitignored) at startup
 * and proxies /api/openai/* requests to api.openai.com with the
 * Authorization header injected server-side. The browser never sees
 * the key.
 *
 * This module exposes:
 *   - `sharedOpenAiAvailable()` — true when the proxy is wired (dev-
 *     server sets a compile-time flag from vite.config.ts).
 *   - `createSharedOpenAiAdapter()` — a ChatAdapter that hits the
 *     dev proxy. Passes a placeholder token because the proxy
 *     overrides it anyway; sending nothing risks some CORS + fetch
 *     preflight quirks.
 *
 * Production note: this is dev-server-only. A production build has
 * no proxy; a real edge-function proxy is future infra work.
 */

import { createOpenAiAdapter } from "./openai-adapter";
import type { ChatAdapter } from "./types";

const SHARED_PROXY_BASE = "/api/openai/v1";

export function sharedOpenAiAvailable(): boolean {
  try {
    return (
      typeof __VROL_SHARED_OPENAI_AVAILABLE__ !== "undefined" && __VROL_SHARED_OPENAI_AVAILABLE__
    );
  } catch {
    return false;
  }
}

export function createSharedOpenAiAdapter(
  opts: { readonly fetch?: typeof globalThis.fetch } = {},
): ChatAdapter {
  return createOpenAiAdapter({
    apiKey: "vrolen-shared-proxy", // overridden by the dev-server proxy
    baseUrl: SHARED_PROXY_BASE,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
}
