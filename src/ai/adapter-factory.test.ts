/**
 * VROL-1148 — createAdapterForProvider tests. The factory + provider
 * catalogue must agree on routing.
 */
import { describe, expect, it, vi } from "vitest";

import { createAdapterForProvider } from "./adapter-factory";
import type { ProviderKey } from "./provider-keys";

function mockFetch(
  responseBody: unknown = { choices: [{ message: { content: "ok" }, finish_reason: "stop" }] },
) {
  const captured: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      statusText: "OK",
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetch: fn as unknown as typeof globalThis.fetch, captured };
}

describe("createAdapterForProvider (VROL-1145)", () => {
  it("routes openai through the OpenAI adapter (bearer auth at api.openai.com)", async () => {
    const { fetch, captured } = mockFetch();
    const key: ProviderKey = { providerId: "openai", apiKey: "sk-test", addedAt: 1 };
    const adapter = createAdapterForProvider(key, { fetch });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "gpt-4o-mini" });
    expect(captured[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("routes anthropic through the Anthropic adapter (x-api-key)", async () => {
    const { fetch, captured } = mockFetch();
    const key: ProviderKey = { providerId: "anthropic", apiKey: "sk-ant", addedAt: 1 };
    const adapter = createAdapterForProvider(key, { fetch });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "claude-3-5-sonnet-latest" });
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("routes openrouter through the OpenAI adapter at openrouter.ai", async () => {
    const { fetch, captured } = mockFetch();
    const key: ProviderKey = { providerId: "openrouter", apiKey: "or-key", addedAt: 1 };
    const adapter = createAdapterForProvider(key, { fetch });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "anthropic/claude-3.5-sonnet" });
    expect(captured[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("routes gemini through the Gemini adapter (?key= query auth)", async () => {
    const { fetch, captured } = mockFetch({
      candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
    });
    const key: ProviderKey = { providerId: "gemini", apiKey: "g-key", addedAt: 1 };
    const adapter = createAdapterForProvider(key, { fetch });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "gemini-flash" });
    expect(captured[0]?.url).toContain("?key=g-key");
  });

  it("routes cloudflare through the OpenAI adapter at api.cloudflare.com", async () => {
    const { fetch, captured } = mockFetch();
    const key: ProviderKey = { providerId: "cloudflare", apiKey: "cf-token", addedAt: 1 };
    const adapter = createAdapterForProvider(key, { fetch });
    await adapter.chat([{ role: "user", content: "hi" }], {
      model: "@cf/meta/llama-3.1-8b-instruct",
    });
    expect(captured[0]?.url.startsWith("https://api.cloudflare.com/client/v4")).toBe(true);
  });

  it("uses ProviderKey.baseUrl override when set", async () => {
    const { fetch, captured } = mockFetch();
    const key: ProviderKey = {
      providerId: "openai",
      apiKey: "sk",
      baseUrl: "https://my-proxy.example.com/v1",
      addedAt: 1,
    };
    const adapter = createAdapterForProvider(key, { fetch });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "gpt-4o-mini" });
    expect(captured[0]?.url).toBe("https://my-proxy.example.com/v1/chat/completions");
  });

  it("throws on an unknown provider id", () => {
    const key = { providerId: "ghost" as never, apiKey: "x", addedAt: 1 };
    expect(() => createAdapterForProvider(key)).toThrow(/unknown provider/i);
  });
});
