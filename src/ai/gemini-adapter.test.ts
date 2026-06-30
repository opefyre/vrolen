/**
 * VROL-382 / VROL-1147 — Gemini adapter tests via mock fetch.
 */
import { describe, expect, it, vi } from "vitest";

import { createGeminiAdapter, geminiRequestBody, parseGeminiResponse } from "./gemini-adapter";
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

const PLAIN_TEXT_RESPONSE = {
  candidates: [
    {
      content: {
        role: "model",
        parts: [{ text: "Hello there." }],
      },
      finishReason: "STOP",
    },
  ],
};

describe("geminiRequestBody (VROL-1144)", () => {
  it("converts user/assistant messages into Gemini's contents shape", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const body = geminiRequestBody(messages, { model: "gemini-flash" });
    const contents = body["contents"] as Array<{ role: string; parts: Array<{ text: string }> }>;
    expect(contents).toEqual([
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "hello" }] },
    ]);
  });

  it("lifts system messages + systemPrompt onto systemInstruction", () => {
    const body = geminiRequestBody(
      [
        { role: "system", content: "First system msg." },
        { role: "user", content: "go" },
      ],
      { model: "gemini-flash", systemPrompt: "Top prompt." },
    );
    const sys = body["systemInstruction"] as { parts: Array<{ text: string }> };
    expect(sys.parts).toEqual([{ text: "Top prompt." }, { text: "First system msg." }]);
    // contents should NOT include the system message.
    const contents = body["contents"] as Array<{ role: string }>;
    expect(contents.every((c) => c.role !== "system")).toBe(true);
  });

  it("expands tools into functionDeclarations", () => {
    const body = geminiRequestBody([], {
      model: "gemini-flash",
      tools: [
        {
          name: "emit_scenario",
          description: "emit a scenario",
          parameters: { type: "object", properties: {} },
        },
      ],
    });
    const tools = body["tools"] as Array<{
      functionDeclarations: Array<{ name: string; description: string }>;
    }>;
    expect(tools[0]?.functionDeclarations).toEqual([
      {
        name: "emit_scenario",
        description: "emit a scenario",
        parameters: { type: "object", properties: {} },
      },
    ]);
  });

  it("expands assistant tool calls into part.functionCall", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "emit_scenario", arguments: '{"a":1}' }],
      },
    ];
    const body = geminiRequestBody(messages, { model: "gemini-flash" });
    const contents = body["contents"] as Array<{
      parts: Array<{ functionCall?: { args: unknown } }>;
    }>;
    expect(contents[0]?.parts[0]?.functionCall).toEqual({
      name: "emit_scenario",
      args: { a: 1 },
    });
  });

  it("respects toolChoice variants", () => {
    expect(
      geminiRequestBody([], { model: "x", toolChoice: { name: "save" } })["toolConfig"],
    ).toEqual({
      functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["save"] },
    });
    expect(geminiRequestBody([], { model: "x", toolChoice: "none" })["toolConfig"]).toEqual({
      functionCallingConfig: { mode: "NONE" },
    });
    expect(geminiRequestBody([], { model: "x", toolChoice: "required" })["toolConfig"]).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
  });

  it("maps temperature + maxTokens into generationConfig", () => {
    const body = geminiRequestBody([], { model: "x", temperature: 0.4, maxTokens: 200 });
    expect(body["generationConfig"]).toEqual({ temperature: 0.4, maxOutputTokens: 200 });
  });
});

describe("parseGeminiResponse", () => {
  it("parses a plain text response", () => {
    const r = parseGeminiResponse(PLAIN_TEXT_RESPONSE);
    expect(r.text).toBe("Hello there.");
    expect(r.finishReason).toBe("stop");
  });

  it("parses functionCall parts into ChatToolCall", () => {
    const r = parseGeminiResponse({
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ functionCall: { name: "emit_scenario", args: { stations: [] } } }],
          },
          finishReason: "STOP",
        },
      ],
    });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.name).toBe("emit_scenario");
    expect(JSON.parse(r.toolCalls[0]?.arguments ?? "{}")).toEqual({ stations: [] });
    expect(r.finishReason).toBe("tool_call");
  });

  it("maps Gemini's finishReason enum to our types", () => {
    expect(parseGeminiResponse({ candidates: [{ finishReason: "MAX_TOKENS" }] }).finishReason).toBe(
      "length",
    );
    expect(parseGeminiResponse({ candidates: [{ finishReason: "SAFETY" }] }).finishReason).toBe(
      "content_filter",
    );
  });

  it("handles empty/null bodies cleanly", () => {
    expect(parseGeminiResponse(null)).toEqual({ text: "", toolCalls: [], finishReason: "stop" });
    expect(parseGeminiResponse({})).toEqual({ text: "", toolCalls: [], finishReason: "stop" });
  });
});

describe("createGeminiAdapter (VROL-1144)", () => {
  it("POSTs with ?key= query auth + JSON body", async () => {
    const { fetch, captured } = mockFetch(PLAIN_TEXT_RESPONSE);
    const adapter = createGeminiAdapter({ apiKey: "gemini-test-key", fetch });
    const r = await adapter.chat([{ role: "user", content: "hi" }], { model: "gemini-flash" });
    expect(r.text).toBe("Hello there.");
    expect(captured[0]?.url).toContain("models/gemini-flash:generateContent");
    expect(captured[0]?.url).toContain("?key=gemini-test-key");
    const headers = captured[0]?.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("propagates error body on non-2xx response", async () => {
    const { fetch } = mockFetch({ error: { message: "API key invalid" } }, 400, "Bad Request");
    const adapter = createGeminiAdapter({ apiKey: "bad", fetch });
    await expect(
      adapter.chat([{ role: "user", content: "x" }], { model: "gemini-flash" }),
    ).rejects.toThrow(/Gemini.*400.*API key invalid/s);
  });

  it("uses baseUrl override (proxy-friendly)", async () => {
    const { fetch, captured } = mockFetch(PLAIN_TEXT_RESPONSE);
    const adapter = createGeminiAdapter({
      apiKey: "x",
      baseUrl: "https://proxy.example.com/gemini/v1beta",
      fetch,
    });
    await adapter.chat([{ role: "user", content: "hi" }], { model: "gemini-flash" });
    expect(captured[0]?.url.startsWith("https://proxy.example.com/gemini/v1beta/")).toBe(true);
  });
});
