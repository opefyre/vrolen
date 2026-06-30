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

  it("VROL-1054 — cap=2 saturated bottleneck fires capacity:set with target 3", () => {
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
    expect(card.tone).toBe("primary");
    expect(card.apply?.kind).toBe("capacity:set");
    if (card.apply?.kind === "capacity:set") {
      expect(card.apply.capacity).toBe(3);
    }
    expect(card.title).toContain("3rd Filler");
  });

  it("VROL-1054 — cap=10 (engine max) does NOT fire the capacity rule", () => {
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
      perStationCapacity: [10, 1, 1],
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

  // ────────────────────────────────────────────────────────────────────────
  // Sprint 185 — VROL-1104 → VROL-1109: 6 new informational rules.
  // Each predicate gets a positive (fires) + a negative case.
  // The baseResult fixture has lineOee=0.75, lineScrapRate=0,
  // averageWipL=5, perStationScrapped=[0,0,0]; these tests overlay
  // ONLY the field needed to trip each predicate to keep the
  // higher-priority rules dormant.
  // ────────────────────────────────────────────────────────────────────────

  it("VROL-1104 — high-scrap rule fires when lineScrapRate > 5 %", () => {
    const r = baseResult({
      lineScrapRate: 0.08,
      perStationScrapped: [10, 90, 5], // worst station = idx 1 (Capper)
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("scrap");
    expect(card.tone).toBe("warn");
    expect(card.apply?.kind).toBe("tip:flag");
    if (card.apply?.kind === "tip:flag") {
      expect(card.apply.stationLabel).toBe("Capper");
    }
  });

  it("VROL-1104 — high-scrap rule hidden when scrap is at or below 5 %", () => {
    const r = baseResult({ lineScrapRate: 0.03 });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("scrap rate");
  });

  it("VROL-1105 — low-line-oee fires when lineOee < 0.5", () => {
    const r = baseResult({ lineOee: 0.4 });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("line oee");
    expect(card.tone).toBe("warn");
    expect(card.apply?.kind).toBe("tip:flag");
  });

  it("VROL-1105 — low-line-oee hidden when OEE ≥ 0.5", () => {
    const r = baseResult({ lineOee: 0.7 });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("line oee is");
  });

  it("VROL-1106 — high-wip rule fires when WIP > 3 × stationCount", () => {
    // 3 stations in baseResult → 3 × 3 = 9. WIP=15 trips it.
    const r = baseResult({ averageWipL: 15 });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("wip");
    expect(card.apply?.kind).toBe("tip:flag");
  });

  it("VROL-1106 — high-wip rule hidden when WIP is below threshold", () => {
    const r = baseResult({ averageWipL: 5 });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("wip averaging");
  });

  it("VROL-1107 — idle-source rule fires when source Idle > 50 %", () => {
    const r = baseResult({
      perStationStateMs: [
        { Idle: 7_000, Running: 3_000 }, // 70 % idle at source
        { Idle: 0, Running: 10_000 },
        { Idle: 0, Running: 10_000 },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("upstream-limited");
    expect(card.apply?.kind).toBe("tip:flag");
    if (card.apply?.kind === "tip:flag") {
      expect(card.apply.stationLabel).toBe("Filler");
    }
  });

  it("VROL-1107 — idle-source rule hidden when source is busy", () => {
    const r = baseResult({
      perStationStateMs: [
        { Idle: 1_000, Running: 9_000 }, // 10 % idle
        { Idle: 0, Running: 10_000 },
        { Idle: 0, Running: 10_000 },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("upstream-limited");
  });

  it("VROL-1108 — setup-dominates rule fires when Setup > 2 × Running", () => {
    const r = baseResult({
      perStationStateMs: [
        { Idle: 0, Running: 8_000 },
        // Station idx=1 (Capper): 8s Setup vs 2s Running → setup-dominates.
        { Setup: 8_000, Running: 2_000 },
        { Idle: 0, Running: 10_000 },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("changeovers swamp work");
    expect(card.apply?.kind).toBe("tip:flag");
    if (card.apply?.kind === "tip:flag") {
      expect(card.apply.stationLabel).toBe("Capper");
    }
  });

  it("VROL-1108 — setup-dominates rule hidden when setup is short", () => {
    const r = baseResult({
      perStationStateMs: [
        { Idle: 0, Running: 10_000 },
        { Setup: 500, Running: 9_000 }, // 5 % setup share
        { Idle: 0, Running: 10_000 },
      ],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("changeovers swamp");
  });

  it("VROL-1109 — per-edge-buffer-saturated rule fires when fill is near peak ≥ 50 % of samples but not EVERY sample", () => {
    // 4 of 5 samples near the peak (10). One sample at 2 keeps the
    // existing "buffer sustained near full" rule (which requires
    // every-of-last-10 ≥ 80 % of peak) from firing — only the new
    // per-edge rule (≥ 95 % for > 50 % of samples) trips.
    const samples = [
      { perEdgeBufferFill: [10, 2] },
      { perEdgeBufferFill: [10, 1] },
      { perEdgeBufferFill: [10, 3] },
      { perEdgeBufferFill: [2, 2] },
      { perEdgeBufferFill: [10, 2] },
    ];
    const r = baseResult({ samples: samples as ChainResult["samples"] });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("saturating");
    expect(card.apply?.kind).toBe("tip:flag");
  });

  it("VROL-1109 — per-edge-buffer-saturated rule hidden when fill varies widely", () => {
    const samples = [
      { perEdgeBufferFill: [1, 2] },
      { perEdgeBufferFill: [10, 1] },
      { perEdgeBufferFill: [2, 3] },
      { perEdgeBufferFill: [9, 2] },
      { perEdgeBufferFill: [3, 2] },
    ];
    const r = baseResult({ samples: samples as ChainResult["samples"] });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).not.toContain("saturating");
  });

  it("VROL-1110 — priority discipline: structural rules still fire ahead of the new ones", () => {
    // High scrap AND high WIP AND low OEE all at once. The high-scrap
    // rule (1104) has highest priority among the new ones, so it
    // should win over the others.
    const r = baseResult({
      lineScrapRate: 0.08,
      averageWipL: 50,
      lineOee: 0.2,
      perStationScrapped: [10, 90, 5],
    });
    const card = deriveActionCard(r)!;
    expect(card.title.toLowerCase()).toContain("scrap");
  });
});
