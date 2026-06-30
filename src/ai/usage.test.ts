/**
 * VROL-414 / VROL-1133 — usage tracking tests.
 */
import { describe, expect, it } from "vitest";

import { always, createMockChatAdapter } from "./mock-adapter";
import {
  createInMemoryUsageStore,
  createLocalStorageUsageStore,
  formatCostEstimate,
  summarizeByDay,
  summarizeByProvider,
  withUsageTracking,
} from "./usage";

describe("createInMemoryUsageStore", () => {
  it("records + lists entries; clear() empties the store", () => {
    const store = createInMemoryUsageStore();
    store.record({ timestamp: 1, model: "x", inputTokens: 10, outputTokens: 5 });
    store.record({ timestamp: 2, model: "y", inputTokens: 8, outputTokens: 3 });
    expect(store.list()).toHaveLength(2);
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});

describe("createLocalStorageUsageStore", () => {
  function fakeStorage() {
    let inner: Record<string, string> = {};
    return {
      getItem: (k: string) => inner[k] ?? null,
      setItem: (k: string, v: string) => {
        inner[k] = v;
      },
      removeItem: (k: string) => {
        delete inner[k];
      },
      _peek: () => inner,
      _reset: () => {
        inner = {};
      },
    };
  }

  it("persists across calls via the supplied storage", () => {
    const fake = fakeStorage();
    const store = createLocalStorageUsageStore("test", fake);
    store.record({ timestamp: 1, model: "x", inputTokens: 10, outputTokens: 5 });
    store.record({ timestamp: 2, model: "y", inputTokens: 8, outputTokens: 3 });
    expect(store.list()).toHaveLength(2);
    // New store reading the same storage sees the same entries.
    const store2 = createLocalStorageUsageStore("test", fake);
    expect(store2.list()).toHaveLength(2);
  });

  it("tolerates malformed JSON without throwing", () => {
    const fake = fakeStorage();
    fake.setItem("test.v1", "not json");
    const store = createLocalStorageUsageStore("test", fake);
    expect(store.list()).toEqual([]);
  });

  it("clear() removes the persisted key", () => {
    const fake = fakeStorage();
    const store = createLocalStorageUsageStore("test", fake);
    store.record({ timestamp: 1, model: "x", inputTokens: 1, outputTokens: 1 });
    store.clear();
    expect(store.list()).toHaveLength(0);
    expect(fake._peek()).not.toHaveProperty("test.v1");
  });

  it("uses 'vrolen.ai-usage' as the default namespace", () => {
    const fake = fakeStorage();
    const store = createLocalStorageUsageStore(undefined, fake);
    store.record({ timestamp: 1, model: "x", inputTokens: 1, outputTokens: 1 });
    expect(fake._peek()).toHaveProperty("vrolen.ai-usage.v1");
  });
});

describe("withUsageTracking (VROL-1130)", () => {
  it("records token estimates after a successful chat", async () => {
    const store = createInMemoryUsageStore();
    const inner = createMockChatAdapter([{ when: always(), text: "ok response" }]);
    const tracked = withUsageTracking(inner, store, { provider: "mock", now: () => 12345 });
    await tracked.chat([{ role: "user", content: "hello world" }], { model: "gpt-4o-mini" });
    const entries = store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.timestamp).toBe(12345);
    expect(entries[0]?.model).toBe("gpt-4o-mini");
    expect(entries[0]?.provider).toBe("mock");
    expect(entries[0]?.inputTokens).toBeGreaterThan(0);
    expect(entries[0]?.outputTokens).toBeGreaterThan(0);
  });

  it("records the call AND re-throws when the inner adapter errors", async () => {
    const store = createInMemoryUsageStore();
    const failing = {
      chat: () => Promise.reject(new Error("rate limited")),
    };
    const tracked = withUsageTracking(failing, store, { now: () => 1 });
    await expect(tracked.chat([{ role: "user", content: "hi" }], { model: "x" })).rejects.toThrow(
      /rate limited/,
    );
    expect(store.list()).toHaveLength(1); // we still recorded the attempt
    expect(store.list()[0]?.outputTokens).toBe(0);
  });

  it("counts system prompt tokens too", async () => {
    const store = createInMemoryUsageStore();
    const inner = createMockChatAdapter([{ when: always(), text: "" }]);
    const tracked = withUsageTracking(inner, store);
    await tracked.chat([{ role: "user", content: "x" }], {
      model: "y",
      systemPrompt: "a".repeat(400), // ~100 estimated tokens
    });
    expect(store.list()[0]?.inputTokens).toBeGreaterThanOrEqual(100);
  });
});

describe("summarizeByDay (VROL-1132)", () => {
  it("groups entries by UTC day and sums tokens + counts", () => {
    const day1 = Date.UTC(2026, 0, 1, 12);
    const day1Later = Date.UTC(2026, 0, 1, 23);
    const day2 = Date.UTC(2026, 0, 2, 1);
    const summary = summarizeByDay([
      { timestamp: day1, model: "x", inputTokens: 10, outputTokens: 5 },
      { timestamp: day1Later, model: "x", inputTokens: 20, outputTokens: 10 },
      { timestamp: day2, model: "y", inputTokens: 100, outputTokens: 50 },
    ]);
    expect(summary).toHaveLength(2);
    expect(summary[0]?.day).toBe("2026-01-01");
    expect(summary[0]?.inputTokens).toBe(30);
    expect(summary[0]?.outputTokens).toBe(15);
    expect(summary[0]?.callCount).toBe(2);
    expect(summary[1]?.day).toBe("2026-01-02");
    expect(summary[1]?.totalTokens).toBe(150);
  });

  it("returns sorted output (oldest first)", () => {
    const entries = [
      { timestamp: Date.UTC(2026, 2, 5), model: "x", inputTokens: 1, outputTokens: 1 },
      { timestamp: Date.UTC(2026, 0, 5), model: "x", inputTokens: 1, outputTokens: 1 },
    ];
    const summary = summarizeByDay(entries);
    expect(summary[0]?.day < (summary[1]?.day ?? "")).toBe(true);
  });
});

describe("summarizeByProvider (VROL-1132)", () => {
  it("groups by provider; unknown when not set", () => {
    const summary = summarizeByProvider([
      { timestamp: 1, model: "x", inputTokens: 10, outputTokens: 5, provider: "openai" },
      { timestamp: 2, model: "x", inputTokens: 20, outputTokens: 10, provider: "openai" },
      { timestamp: 3, model: "y", inputTokens: 100, outputTokens: 50 },
    ]);
    expect(summary).toHaveLength(2);
    const openai = summary.find((s) => s.provider === "openai");
    expect(openai?.callCount).toBe(2);
    expect(openai?.totalTokens).toBe(45);
    const unknown = summary.find((s) => s.provider === "unknown");
    expect(unknown?.callCount).toBe(1);
  });
});

describe("formatCostEstimate (VROL-1132)", () => {
  it("returns a $-formatted cost for known models", () => {
    expect(
      formatCostEstimate(
        { callCount: 1, inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
        "gpt-4o",
      ),
    ).toBe("$5.00");
  });

  it("rounds tiny costs to '< $0.01'", () => {
    expect(
      formatCostEstimate(
        { callCount: 1, inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        "gpt-4o-mini",
      ),
    ).toBe("< $0.01");
  });

  it("returns '—' for unknown models", () => {
    expect(
      formatCostEstimate(
        { callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        "phantom",
      ),
    ).toBe("—");
  });
});
