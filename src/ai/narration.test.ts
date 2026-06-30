/**
 * VROL-410 / VROL-1129 — narration tests.
 */
import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";
import { always, createMockChatAdapter } from "./mock-adapter";
import { deriveDeterministicNarration, narrateRun, narrationSystemPrompt } from "./narration";

function baseResult(overrides: Partial<ChainResult> = {}): ChainResult {
  return {
    completed: 1000,
    throughputLambda: 1000 / 60_000,
    elapsedMs: 60_000,
    averageWipL: 5,
    avgTimeInSystemW: 250,
    lineOee: 0.75,
    lineScrapRate: 0,
    bottleneckStationIdx: 0,
    bottlenecks: [
      {
        stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
        label: "Filler",
        runningPct: 0.6,
        bindingScore: 0.6,
        primaryReason: "running",
        breakdown: [{ state: "Running", pct: 0.6 }],
      },
    ],
    perEdgeFlowed: [],
    perStationCompleted: [1000, 1000, 1000],
    perStationScrapped: [0, 0, 0],
    perStationReworked: [0, 0, 0],
    perStationOee: [
      { availability: 1, performance: 1, quality: 1, oee: 1 },
      { availability: 0.9, performance: 0.95, quality: 1, oee: 0.855 },
      { availability: 1, performance: 1, quality: 1, oee: 1 },
    ],
    perStationLabels: ["Filler", "Capper", "Packer"],
    perStationRunningPct: [0.6, 0.5, 0.4],
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
    totalEnergyJ: 0,
    totalWaterL: 0,
    totalCO2eG: 0,
    ...overrides,
  } as unknown as ChainResult;
}

describe("deriveDeterministicNarration (VROL-1126)", () => {
  it("extracts throughput, OEE, bottleneck label and reason", () => {
    const b = deriveDeterministicNarration(baseResult());
    expect(b.throughputPerHour).toBe(60_000);
    expect(b.lineOee).toBeCloseTo(0.75, 2);
    expect(b.bottleneckLabel).toBe("Filler");
    expect(b.bottleneckReason).toBe("running");
  });

  it("identifies the slim OEE factor at the bottleneck", () => {
    const r = baseResult({
      bottleneckStationIdx: 1,
      perStationOee: [
        { availability: 1, performance: 1, quality: 1, oee: 1 },
        { availability: 0.5, performance: 0.95, quality: 1, oee: 0.475 },
        { availability: 1, performance: 1, quality: 1, oee: 1 },
      ],
    });
    const b = deriveDeterministicNarration(r);
    expect(b.slimOeeFactor).toBe("availability");
  });

  it("surfaces sustainability when totalEnergyJ > 0", () => {
    const r = baseResult({ totalEnergyJ: 5000, completed: 100 });
    const b = deriveDeterministicNarration(r);
    expect(b.sustainability).toEqual({ totalEnergyJ: 5000, energyPerPartJ: 50 });
  });

  it("leaves sustainability null when no inputs declared", () => {
    const b = deriveDeterministicNarration(baseResult());
    expect(b.sustainability).toBeNull();
  });

  it("captures the top action card title when one fires", () => {
    const r = baseResult({ lineScrapRate: 0.08, perStationScrapped: [10, 90, 5] });
    const b = deriveDeterministicNarration(r);
    expect(b.topActionCardTitle).toBeTruthy();
    expect(b.topActionCardTitle?.toLowerCase()).toContain("scrap");
  });
});

describe("narrateRun (VROL-1128)", () => {
  it("returns the LLM's polish when the adapter responds with text", async () => {
    const adapter = createMockChatAdapter([
      { when: always(), text: "Throughput sat at about 1,000 parts/h with the Filler binding." },
    ]);
    const r = await narrateRun(adapter, baseResult());
    expect(r.text).toContain("Throughput");
    expect(r.source).toBe("llm");
    expect(r.bundle.bottleneckLabel).toBe("Filler");
  });

  it("falls back to the deterministic template when the adapter returns empty", async () => {
    const adapter = createMockChatAdapter();
    const r = await narrateRun(adapter, baseResult());
    expect(r.source).toBe("fallback");
    expect(r.text).toContain("Line ran at");
    expect(r.text).toContain("Filler");
  });

  it("falls back when the adapter throws", async () => {
    const adapter = {
      chat: () => Promise.reject(new Error("provider down")),
    };
    const r = await narrateRun(adapter, baseResult());
    expect(r.source).toBe("fallback");
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("uses the system prompt + sends the bundle as JSON", async () => {
    const adapter = createMockChatAdapter([{ when: always(), text: "ok." }]);
    await narrateRun(adapter, baseResult());
    const call = adapter.calls[0];
    expect(call?.options.systemPrompt).toBe(narrationSystemPrompt());
    // bundle JSON is in the user message
    const userMsg = call?.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("throughputPerHour");
  });

  it("forwards model + temperature overrides to the adapter", async () => {
    const adapter = createMockChatAdapter([{ when: always(), text: "ok." }]);
    await narrateRun(adapter, baseResult(), { model: "gpt-4o-mini", temperature: 0.7 });
    expect(adapter.calls[0]?.options.model).toBe("gpt-4o-mini");
    expect(adapter.calls[0]?.options.temperature).toBe(0.7);
  });
});
