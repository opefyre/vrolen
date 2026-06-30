/**
 * VROL-379 / VROL-1117 — MockChatAdapter unit tests.
 */
import { describe, expect, it } from "vitest";

import { always, createMockChatAdapter, matchLastUser, matchModel } from "./mock-adapter";
import type { ChatMessage, ChatOptions } from "./types";

const baseOpts: ChatOptions = { model: "test-model" };

describe("createMockChatAdapter", () => {
  it("returns the catch-all default when no rule matches", async () => {
    const adapter = createMockChatAdapter();
    const r = await adapter.chat([{ role: "user", content: "hi" }], baseOpts);
    expect(r.text).toBe("");
    expect(r.toolCalls).toEqual([]);
    expect(r.finishReason).toBe("stop");
  });

  it("records every chat() call in order", async () => {
    const adapter = createMockChatAdapter();
    await adapter.chat([{ role: "user", content: "one" }], baseOpts);
    await adapter.chat([{ role: "user", content: "two" }], { ...baseOpts, temperature: 0.7 });
    expect(adapter.calls).toHaveLength(2);
    expect(adapter.calls[0]?.messages[0]?.content).toBe("one");
    expect(adapter.calls[1]?.options.temperature).toBe(0.7);
  });

  it("reset() clears the call log without dropping rules", async () => {
    const adapter = createMockChatAdapter([{ when: always(), text: "canned" }]);
    await adapter.chat([{ role: "user", content: "x" }], baseOpts);
    expect(adapter.calls).toHaveLength(1);
    adapter.reset();
    expect(adapter.calls).toHaveLength(0);
    const r = await adapter.chat([{ role: "user", content: "y" }], baseOpts);
    expect(r.text).toBe("canned");
  });

  it("first matching rule wins (order matters)", async () => {
    const adapter = createMockChatAdapter([
      { when: matchLastUser(/hello/i), text: "english" },
      { when: always(), text: "fallback" },
    ]);
    const r1 = await adapter.chat([{ role: "user", content: "Hello there" }], baseOpts);
    expect(r1.text).toBe("english");
    const r2 = await adapter.chat([{ role: "user", content: "what" }], baseOpts);
    expect(r2.text).toBe("fallback");
  });

  it("auto-derives finishReason='tool_call' when toolCalls is non-empty", async () => {
    const adapter = createMockChatAdapter([
      {
        when: always(),
        toolCalls: [{ id: "c1", name: "save", arguments: "{}" }],
      },
    ]);
    const r = await adapter.chat([{ role: "user", content: "save" }], baseOpts);
    expect(r.finishReason).toBe("tool_call");
    expect(r.toolCalls).toHaveLength(1);
  });

  it("explicit finishReason on the rule wins over auto-derived", async () => {
    const adapter = createMockChatAdapter([
      {
        when: always(),
        text: "truncated mid-think",
        finishReason: "length",
      },
    ]);
    const r = await adapter.chat([{ role: "user", content: "go" }], baseOpts);
    expect(r.finishReason).toBe("length");
  });

  it("matchLastUser scans backwards — finds the most recent user turn", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "first" },
      { role: "assistant", content: "ack" },
      { role: "user", content: "second contains JSON marker" },
      { role: "assistant", content: "tool call" },
    ];
    expect(matchLastUser(/JSON/i)(messages, baseOpts)).toBe(true);
    expect(matchLastUser(/first/i)(messages, baseOpts)).toBe(false);
  });

  it("matchModel matches only the configured model name", () => {
    expect(matchModel("gemini-flash")([], { model: "gemini-flash" })).toBe(true);
    expect(matchModel("gemini-flash")([], { model: "gpt-4o" })).toBe(false);
  });

  it("customizing defaultResponse changes the catch-all", async () => {
    const adapter = createMockChatAdapter([], {
      text: "custom-fallback",
      toolCalls: [],
      finishReason: "stop",
    });
    const r = await adapter.chat([{ role: "user", content: "x" }], baseOpts);
    expect(r.text).toBe("custom-fallback");
  });
});
