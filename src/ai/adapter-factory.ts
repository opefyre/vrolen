/**
 * VROL-1145 — single entry point that takes a ProviderKey + optional
 * fetch and returns a ChatAdapter for the right provider. Hosts that
 * just want "give me an adapter for whatever the user configured"
 * call this instead of caring about the per-provider constructors.
 *
 * Falls through to throwing on unsupported providers so a typo in
 * storage doesn't silently route through a no-op.
 */

import { createOpenAiAdapter, createAnthropicAdapter } from "./openai-adapter";
import { createGeminiAdapter } from "./gemini-adapter";
import { lookupProvider, type ProviderKey } from "./provider-keys";
import type { ChatAdapter } from "./types";

export interface AdapterFactoryOptions {
  /** Optional fetch override — defaults to globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
}

export function createAdapterForProvider(
  key: ProviderKey,
  opts: AdapterFactoryOptions = {},
): ChatAdapter {
  const provider = lookupProvider(key.providerId);
  if (!provider) {
    throw new Error(`createAdapterForProvider: unknown provider "${String(key.providerId)}"`);
  }
  const baseUrl = key.baseUrl ?? provider.defaultBaseUrl;
  switch (key.providerId) {
    case "openai":
    case "openrouter":
    case "cloudflare":
      // All three speak the OpenAI chat-completions wire format with
      // bearer auth. Base URL differs; that's it.
      return createOpenAiAdapter({
        apiKey: key.apiKey,
        baseUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
    case "anthropic":
      return createAnthropicAdapter({
        apiKey: key.apiKey,
        baseUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
    case "gemini":
      return createGeminiAdapter({
        apiKey: key.apiKey,
        baseUrl,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      });
  }
}
