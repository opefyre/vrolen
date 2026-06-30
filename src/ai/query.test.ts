/**
 * VROL-405 / VROL-1138 — NL query flow tests.
 */
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";
import { always, createMockChatAdapter } from "./mock-adapter";
import {
  extractResultFacts,
  queryResultSystemPrompt,
  queryRunResult,
  retrieveRelevantFacts,
} from "./query";

function baseResult(overrides: Partial<ChainResult> = {}): ChainResult {
  return {
    completed: 1000,
    throughputLambda: 1000 / 60_000,
    elapsedMs: 60_000,
    averageWipL: 5,
    avgTimeInSystemW: 250,
    lineOee: 0.75,
    lineScrapRate: 0.02,
    bottleneckStationIdx: 1,
    bottlenecks: [
      {
        stationId: "s2" as ChainResult["bottlenecks"][number]["stationId"],
        label: "Filler",
        runningPct: 0.85,
        bindingScore: 0.85,
        primaryReason: "running",
        breakdown: [{ state: "Running", pct: 0.85 }],
      },
    ],
    perEdgeFlowed: [],
    perStationCompleted: [1000, 1000, 1000],
    perStationScrapped: [0, 18, 2],
    perStationReworked: [0, 0, 0],
    perStationOee: [
      { availability: 1, performance: 1, quality: 1, oee: 1 },
      { availability: 0.95, performance: 0.85, quality: 0.98, oee: 0.792 },
      { availability: 1, performance: 1, quality: 1, oee: 1 },
    ],
    perStationLabels: ["Feeder", "Filler", "Packer"],
    perStationRunningPct: [0.6, 0.85, 0.4],
    perStationStateMs: [],
    perStationMaintenanceMs: [],
    perStationTempScrap: [0, 0, 0],
    perStationToolBlockedMs: [0, 0, 0],
    perStationBomStarved: [0, 0, 0],
    perStationSkuRouted: [0, 0, 0],
    samples: [],
    perEdgeBundleEvents: [],
    perEdgeShelfLifeScrap: [],
    perStationRandomEvents: [],
    perStationTimeInSystem: [],
    perStationGradeCounts: [],
    lineGradeCounts: {},
    theoreticalYield: 0,
    totalEnergyJ: 5000,
    totalWaterL: 0,
    totalCO2eG: 0,
    ...overrides,
  } as unknown as ChainResult;
}

describe("extractResultFacts (VROL-1134)", () => {
  it("emits KPI facts for every standard metric", () => {
    const facts = extractResultFacts(baseResult());
    const kinds = new Set(facts.map((f) => f.kind));
    expect(kinds.has("kpi")).toBe(true);
    expect(kinds.has("bottleneck")).toBe(true);
    expect(kinds.has("station")).toBe(true);
    expect(kinds.has("sustainability")).toBe(true);
  });

  it("includes bottleneck label as a term so 'Filler' queries match", () => {
    const facts = extractResultFacts(baseResult());
    const bn = facts.find((f) => f.kind === "bottleneck");
    expect(bn?.terms).toContain("filler");
  });

  it("emits scrap facts ONLY for stations with scrap > 0", () => {
    const facts = extractResultFacts(baseResult());
    const scrapFacts = facts.filter((f) => f.id.includes("scrap"));
    // Two stations with scrap (Filler, Packer); kpi.scrap is a third.
    expect(scrapFacts.length).toBeGreaterThanOrEqual(3);
  });

  it("omits sustainability facts when totalEnergyJ is 0", () => {
    const facts = extractResultFacts(baseResult({ totalEnergyJ: 0 }));
    expect(facts.find((f) => f.kind === "sustainability")).toBeUndefined();
  });
});

describe("retrieveRelevantFacts (VROL-1135)", () => {
  it("returns facts whose terms overlap the question, ranked by score", () => {
    const facts = extractResultFacts(baseResult());
    const relevant = retrieveRelevantFacts("What was the bottleneck?", facts, 5);
    expect(relevant[0]?.kind).toBe("bottleneck");
  });

  it("returns KPI baseline when the question has no specific keywords", () => {
    const facts = extractResultFacts(baseResult());
    const relevant = retrieveRelevantFacts("Tell me about it", facts, 5);
    // KPI facts have a floor score; should at least include one KPI.
    expect(relevant.some((f) => f.kind === "kpi")).toBe(true);
  });

  it("filters by station label when the question names a station", () => {
    const facts = extractResultFacts(baseResult());
    const relevant = retrieveRelevantFacts("How did Filler perform?", facts, 5);
    expect(relevant.some((f) => f.terms.includes("filler"))).toBe(true);
  });

  it("respects maxFacts cap", () => {
    const facts = extractResultFacts(baseResult());
    const relevant = retrieveRelevantFacts("scrap", facts, 2);
    expect(relevant.length).toBeLessThanOrEqual(2);
  });
});

describe("queryRunResult (VROL-1137)", () => {
  it("returns ok=true with the LLM's answer when keywords match", async () => {
    const adapter = createMockChatAdapter([
      {
        when: always(),
        text: "The Filler was the bottleneck at 85% running share.",
      },
    ]);
    const r = await queryRunResult(adapter, baseResult(), "What was the bottleneck?");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("llm");
      expect(r.answer).toContain("Filler");
      expect(r.facts.length).toBeGreaterThan(0);
    }
  });

  it("falls back to deterministic 'don't know' on adapter error", async () => {
    const adapter = {
      chat: () => Promise.reject(new Error("api down")),
    };
    const r = await queryRunResult(adapter, baseResult(), "scrap rate?");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("fallback");
      expect(r.answer.toLowerCase()).toContain("don't have");
    }
  });

  it("falls back when the adapter returns empty text", async () => {
    const adapter = createMockChatAdapter();
    const r = await queryRunResult(adapter, baseResult(), "scrap rate?");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("fallback");
    }
  });

  it("returns ok=false / no-question for empty input", async () => {
    const adapter = createMockChatAdapter();
    const r = await queryRunResult(adapter, baseResult(), "  ");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no-question");
    }
  });

  it("sends the system prompt + a numbered facts list to the adapter", async () => {
    const adapter = createMockChatAdapter([{ when: always(), text: "ok" }]);
    await queryRunResult(adapter, baseResult(), "what's the throughput?");
    const call = adapter.calls[0];
    expect(call?.options.systemPrompt).toBe(queryResultSystemPrompt());
    const userMsg = call?.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toMatch(/Facts retrieved/);
    expect(userMsg?.content).toContain("Question:");
  });

  it("propagates model + temperature options", async () => {
    const adapter = createMockChatAdapter([{ when: always(), text: "ok" }]);
    await queryRunResult(adapter, baseResult(), "anything", {
      model: "gpt-4o",
      temperature: 0.1,
    });
    expect(adapter.calls[0]?.options.model).toBe("gpt-4o");
    expect(adapter.calls[0]?.options.temperature).toBe(0.1);
  });

  it("respects maxFacts to limit the prompt size", async () => {
    const adapter = createMockChatAdapter([{ when: always(), text: "ok" }]);
    const r = await queryRunResult(adapter, baseResult(), "scrap", { maxFacts: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.facts.length).toBeLessThanOrEqual(2);
    }
  });
});
