/**
 * VROL-959 — coverage for derive-action-card. Builds minimal ChainResult
 * fixtures that trigger each rule branch and asserts the returned
 * {title contains marker, tone, apply.kind} shape.
 */

import { describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";
import { deriveActionCard } from "./derive-action-card";

// Build a baseline well-formed result the tests can overlay onto.
function baseResult(overrides: Partial<ChainResult> = {}): ChainResult {
  const r: ChainResult = {
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
  } as unknown as ChainResult;
  return { ...r, ...overrides };
}

describe("deriveActionCard (VROL-948 / VROL-959)", () => {
  it("returns null when no per-station OEE is present", () => {
    const r = baseResult({ perStationOee: [] });
    expect(deriveActionCard(r)).toBeNull();
  });

  it("rule 1 — flags reliability work when bottleneck spent > 15% Down", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.5,
          bindingScore: 0.5,
          primaryReason: "breakdown",
          breakdown: [
            { state: "Down", pct: 0.3 },
            { state: "Running", pct: 0.5 },
          ],
        },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.tone).toBe("warn");
    expect(card.apply?.kind).toBe("reliability:flag");
    expect(card.title.toLowerCase()).toContain("reliability");
  });

  it("rule 2 — flags subordination when nominalSpeedRatio < 0.8", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.9,
          bindingScore: 0.7,
          primaryReason: "running",
          breakdown: [{ state: "Running", pct: 0.9 }],
          nominalSpeedRatio: 0.6,
        },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.apply?.kind).toBe("cycle:halve");
    expect(card.tone).toBe("primary");
  });

  it("rule 3 — flags BOM imbalance when total bom-starved > 50", () => {
    const r = baseResult({ perStationBomStarved: [0, 60, 0] });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("bom");
    expect(card.tone).toBe("warn");
  });

  it("rule 4 — flags tool-pool contention when blocked > 20% of horizon", () => {
    const r = baseResult({
      perStationToolBlockedMs: [0, 20_000, 0],
      elapsedMs: 60_000,
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("tool-pool");
    expect(card.tone).toBe("warn");
  });

  it("rule 5 — flags downstream-blocked bottleneck", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.85,
          bindingScore: 0.85,
          primaryReason: "blocking",
          breakdown: [{ state: "BlockedOut", pct: 0.85 }],
        },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("blocked");
  });

  it("fallback — points at the slim OEE factor when no rule fires", () => {
    const r = baseResult();
    const card = deriveActionCard(r)!;
    expect(card.tone).toBe("info");
    // Performance is the slim factor for Capper (0.95) but Capper is not
    // the bottleneck — fallback should point at the bottleneck (Filler,
    // all 1.0). Title surfaces "slim factor" wording.
    expect(card.title.toLowerCase()).toMatch(/slim|healthy/);
  });

  it("VROL-1010 — batch-fire bottleneck with high starved share fires the partial-batch rule", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.3,
          bindingScore: 0.3,
          primaryReason: "starved",
          breakdown: [
            { state: "Running", pct: 0.3 },
            { state: "Starved", pct: 0.5 },
          ],
        },
      ],
    });
    const card = deriveActionCard(r, { perStationBatchSize: [10, 1, 1] })!;
    expect(card.tone).toBe("warn");
    expect(card.title.toLowerCase()).toContain("partial batch");
    expect(card.body).toMatch(/upstream|shrink batchSize/);
  });

  it("VROL-1010 — batchSize=1 bottleneck does NOT fire the partial-batch rule", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.3,
          bindingScore: 0.3,
          primaryReason: "starved",
          breakdown: [
            { state: "Running", pct: 0.3 },
            { state: "Starved", pct: 0.5 },
          ],
        },
      ],
    });
    const card = deriveActionCard(r, { perStationBatchSize: [1, 1, 1] })!;
    expect(card.title.toLowerCase()).not.toContain("partial batch");
  });

  it("VROL-1021 — energy hotspot rule fires when one station > 60 % of total energy", () => {
    const r = baseResult({
      totalEnergyJ: 100_000,
      perStationEnergyJ: [80_000, 10_000, 10_000],
      perStationLabels: ["Filler", "Capper", "Packer"],
    });
    const card = deriveActionCard(r)!;
    expect(card.tone).toBe("warn");
    expect(card.title.toLowerCase()).toContain("energy hotspot");
    expect(card.title).toContain("Filler");
    expect(card.title).toMatch(/80\s*%/);
  });

  it("VROL-1032 — energy hotspot carries an energy:scale apply payload", () => {
    const r = baseResult({
      totalEnergyJ: 100_000,
      perStationEnergyJ: [80_000, 10_000, 10_000],
      perStationLabels: ["Filler", "Capper", "Packer"],
    });
    const card = deriveActionCard(r)!;
    expect(card.apply?.kind).toBe("energy:scale");
    if (card.apply?.kind === "energy:scale") {
      expect(card.apply.stationLabel).toBe("Filler");
      expect(card.apply.multiplier).toBe(0.75);
    }
  });

  it("VROL-1021 — distributed energy does NOT fire the hotspot rule", () => {
    const r = baseResult({
      totalEnergyJ: 100_000,
      perStationEnergyJ: [35_000, 35_000, 30_000],
      perStationLabels: ["Filler", "Capper", "Packer"],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("energy hotspot");
  });

  it("VROL-1021 — trivial total energy does NOT fire the hotspot rule", () => {
    const r = baseResult({
      totalEnergyJ: 500,
      perStationEnergyJ: [500, 0, 0],
      perStationLabels: ["Filler", "Capper", "Packer"],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("energy hotspot");
  });

  it("VROL-1041 — saturated cap=1 bottleneck fires the capacity:set rule", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.95,
          bindingScore: 0.95,
          primaryReason: "running",
          breakdown: [{ state: "Running", pct: 0.95 }],
        },
      ],
      perStationCapacity: [1, 1, 1],
    });
    const card = deriveActionCard(r)!;
    expect(card.tone).toBe("primary");
    expect(card.apply?.kind).toBe("capacity:set");
    if (card.apply?.kind === "capacity:set") {
      expect(card.apply.stationLabel).toBe("Filler");
      expect(card.apply.capacity).toBe(2);
    }
  });

  it("VROL-1041 — cap=2 bottleneck does NOT fire the capacity rule", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.95,
          bindingScore: 0.95,
          primaryReason: "running",
          breakdown: [{ state: "Running", pct: 0.95 }],
        },
      ],
      perStationCapacity: [2, 1, 1],
    });
    const card = deriveActionCard(r)!;
    expect(card.apply?.kind ?? "").not.toBe("capacity:set");
  });

  it("VROL-1010 — without opts, partial-batch rule never fires", () => {
    const r = baseResult({
      bottlenecks: [
        {
          stationId: "s1" as ChainResult["bottlenecks"][number]["stationId"],
          label: "Filler",
          runningPct: 0.3,
          bindingScore: 0.3,
          primaryReason: "starved",
          breakdown: [
            { state: "Running", pct: 0.3 },
            { state: "Starved", pct: 0.5 },
          ],
        },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("partial batch");
  });
});
