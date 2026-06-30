/**
 * VROL-386 / VROL-1146 — OpenAI + Anthropic adapter tests via mock fetch.
 */
import { describe, expect, it, vi } from "vitest";

import { createAnthropicAdapter, createOpenAiAdapter } from "./openai-adapter";
import type { ChatMessage } from "./types";

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit;
}

function mockFetch(responseBody: unknown, status = 200, statusText = "OK") {
  const captured: CapturedRequest[] = [];
  const fn = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(responseBody), {
      status,
      statusText,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fetch: fn as unknown as typeof globalThis.fetch, captured };
}

const VALID_RESPONSE = {
  choices: [
    {
      message: { content: "Hello there." },
      finish_reason: "stop",
    },
  ],
};

describe("createOpenAiAdapter (VROL-1142)", () => {
  it("POSTs to /chat/completions with bearer auth + JSON body", async () => {
    const { fetch, captured } = mockFetch(VALID_RESPONSE);
    const adapter = createOpenAiAdapter({ apiKey: "sk-test", fetch });
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    const r = await adapter.chat(messages, { model: "gpt-4o-mini" });
    expect(r.text).toBe("Hello there.");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
    const bodyStr = captured[0]?.init.body as string;
    const body = JSON.parse(bodyStr) as { model: string; messages: unknown[] };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages).toEqual([{ role: "user", content: "hello" }]);
  });

  it("uses baseUrl override + strips trailing slashes", async () => {
    const { fetch, captured } = mockFetch(VALID_RESPONSE);
    const adapter = createOpenAiAdapter({
      apiKey: "sk-test",
      baseUrl: "https://openrouter.ai/api/v1/",
      fetch,
    });
    await adapter.chat([{ role: "user", content: "x" }], { model: "any" });
    expect(captured[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("merges extraHeaders onto the defaults", async () => {
    const { fetch, captured } = mockFetch(VALID_RESPONSE);
    const adapter = createOpenAiAdapter({
      apiKey: "sk",
      fetch,
      extraHeaders: { "OpenAI-Beta": "assistants=v2" },
    });
    await adapter.chat([{ role: "user", content: "x" }], { model: "y" });
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["OpenAI-Beta"]).toBe("assistants=v2");
    expect(headers["Authorization"]).toBe("Bearer sk");
  });

  it("throws with provider error body on non-2xx response", async () => {
    const { fetch } = mockFetch({ error: "invalid_api_key" }, 401, "Unauthorized");
    const adapter = createOpenAiAdapter({ apiKey: "sk-bad", fetch });
    await expect(adapter.chat([{ role: "user", content: "x" }], { model: "y" })).rejects.toThrow(
      /401.*Unauthorized.*invalid_api_key/s,
    );
  });

  it("parses tool calls from the response body", async () => {
    const { fetch } = mockFetch({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "emit_scenario", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const adapter = createOpenAiAdapter({ apiKey: "sk", fetch });
    const r = await adapter.chat([{ role: "user", content: "go" }], { model: "x" });
    expect(r.finishReason).toBe("tool_call");
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("emit_scenario");
  });
});

describe("createAnthropicAdapter (VROL-1143)", () => {
  it("uses x-api-key + anthropic-version headers (not bearer)", async () => {
    const { fetch, captured } = mockFetch(VALID_RESPONSE);
    const adapter = createAnthropicAdapter({ apiKey: "sk-ant-test", fetch });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "claude-3-5-sonnet-latest" });
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("allows overriding the anthropic-version", async () => {
    const { fetch, captured } = mockFetch(VALID_RESPONSE);
    const adapter = createAnthropicAdapter({
      apiKey: "sk-ant",
      anthropicVersion: "2024-12-01",
      fetch,
    });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "x" });
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe("2024-12-01");
  });

  it("posts to api.anthropic.com/v1/chat/completions by default", async () => {
    const { fetch, captured } = mockFetch(VALID_RESPONSE);
    const adapter = createAnthropicAdapter({ apiKey: "sk", fetch });
    await adapter.chat([{ role: "user", content: "x" }], { model: "y" });
    expect(captured[0]?.url).toBe("https://api.anthropic.com/v1/chat/completions");
  });

  it("propagates provider error body on non-2xx", async () => {
    const { fetch } = mockFetch({ error: "rate_limit" }, 429, "Too Many Requests");
    const adapter = createAnthropicAdapter({ apiKey: "sk", fetch });
    await expect(adapter.chat([{ role: "user", content: "x" }], { model: "y" })).rejects.toThrow(
      /429.*rate_limit/s,
    );
  });
});
