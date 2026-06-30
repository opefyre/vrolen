/**
 * VROL-379 / VROL-1117 — OpenAI request/response shape tests.
 */
import { describe, expect, it } from "vitest";

import { openAiChatRequestBody, parseOpenAiChatResponse } from "./openai-shape";
import type { ChatMessage, ChatOptions } from "./types";

describe("openAiChatRequestBody", () => {
  it("emits minimal body for a chat-only request", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];
    const body = openAiChatRequestBody(messages, { model: "gpt-4o-mini" });
    expect(body).toEqual({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("prepends a system message when systemPrompt is set", () => {
    const messages: ChatMessage[] = [{ role: "user", content: "hi" }];
    const body = openAiChatRequestBody(messages, {
      model: "gpt-4o-mini",
      systemPrompt: "You are a sim assistant.",
    });
    expect(body["messages"]).toEqual([
      { role: "system", content: "You are a sim assistant." },
      { role: "user", content: "hi" },
    ]);
  });

  it("expands toolCalls into OpenAI's wire shape", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "save it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", name: "save", arguments: '{"name":"line"}' }],
      },
    ];
    const body = openAiChatRequestBody(messages, { model: "gpt-4o" });
    const last = (body["messages"] as Record<string, unknown>[])[1];
    expect(last["tool_calls"]).toEqual([
      {
        id: "c1",
        type: "function",
        function: { name: "save", arguments: '{"name":"line"}' },
      },
    ]);
  });

  it("expands toolCallId onto tool-role messages", () => {
    const messages: ChatMessage[] = [
      {
        role: "tool",
        content: '{"ok":true}',
        toolCallId: "c1",
      },
    ];
    const body = openAiChatRequestBody(messages, { model: "gpt-4o" });
    const last = (body["messages"] as Record<string, unknown>[])[0];
    expect(last["tool_call_id"]).toBe("c1");
  });

  it("expands tools array with the function wrapper", () => {
    const opts: ChatOptions = {
      model: "gpt-4o",
      tools: [
        {
          name: "save",
          description: "save a scenario",
          parameters: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      ],
    };
    const body = openAiChatRequestBody([], opts);
    expect(body["tools"]).toEqual([
      {
        type: "function",
        function: {
          name: "save",
          description: "save a scenario",
          parameters: {
            type: "object",
            properties: { name: { type: "string" } },
          },
        },
      },
    ]);
  });

  it("emits temperature + maxTokens only when set (omits otherwise)", () => {
    const body = openAiChatRequestBody([], { model: "x" });
    expect(body["temperature"]).toBeUndefined();
    expect(body["max_tokens"]).toBeUndefined();
    const body2 = openAiChatRequestBody([], { model: "x", temperature: 0.5, maxTokens: 200 });
    expect(body2["temperature"]).toBe(0.5);
    expect(body2["max_tokens"]).toBe(200);
  });

  it("maps toolChoice variants correctly", () => {
    expect(openAiChatRequestBody([], { model: "x", toolChoice: "auto" })["tool_choice"]).toBe(
      "auto",
    );
    expect(openAiChatRequestBody([], { model: "x", toolChoice: "none" })["tool_choice"]).toBe(
      "none",
    );
    expect(openAiChatRequestBody([], { model: "x", toolChoice: "required" })["tool_choice"]).toBe(
      "required",
    );
    expect(
      openAiChatRequestBody([], { model: "x", toolChoice: { name: "save" } })["tool_choice"],
    ).toEqual({ type: "function", function: { name: "save" } });
  });
});

describe("parseOpenAiChatResponse", () => {
  it("parses a plain text response", () => {
    const r = parseOpenAiChatResponse({
      choices: [{ message: { content: "Hello there." }, finish_reason: "stop" }],
    });
    expect(r.text).toBe("Hello there.");
    expect(r.toolCalls).toEqual([]);
    expect(r.finishReason).toBe("stop");
  });

  it("parses tool_calls into ChatToolCall objects", () => {
    const r = parseOpenAiChatResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "save", arguments: '{"a":1}' },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    expect(r.toolCalls).toEqual([{ id: "c1", name: "save", arguments: '{"a":1}' }]);
    expect(r.finishReason).toBe("tool_call");
    expect(r.text).toBe("");
  });

  it("maps OpenAI finish_reason values to our enum", () => {
    expect(parseOpenAiChatResponse({ choices: [{ finish_reason: "length" }] }).finishReason).toBe(
      "length",
    );
    expect(
      parseOpenAiChatResponse({ choices: [{ finish_reason: "content_filter" }] }).finishReason,
    ).toBe("content_filter");
  });

  it("returns a clean empty response on an empty / missing body", () => {
    const r1 = parseOpenAiChatResponse({});
    expect(r1).toEqual({ text: "", toolCalls: [], finishReason: "stop" });
    const r2 = parseOpenAiChatResponse(null);
    expect(r2.text).toBe("");
  });

  it("auto-bumps finishReason to 'tool_call' when tool_calls present but provider sent 'stop'", () => {
    // Some providers emit finish_reason='stop' even when tool_calls is set.
    // We treat any tool-call payload as tool_call regardless.
    const r = parseOpenAiChatResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }],
          },
          finish_reason: "stop",
        },
      ],
    });
    expect(r.finishReason).toBe("tool_call");
  });

  it("drops malformed tool_call entries (missing id or name)", () => {
    const r = parseOpenAiChatResponse({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              { id: "c1", function: { name: "ok", arguments: "{}" } },
              { id: "c2" }, // missing function — drop
              { function: { name: "f", arguments: "{}" } }, // missing id — drop
            ],
          },
        },
      ],
    });
    expect(r.toolCalls).toHaveLength(1);
    expect(r.toolCalls[0]?.id).toBe("c1");
  });
});
