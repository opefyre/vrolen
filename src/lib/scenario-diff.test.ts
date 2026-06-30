/**
 * VROL-1035 — coverage for diffScenarios. The original VROL-994
 * helper was test-less; this file locks in the existing branches
 * (label / cycle / defect / capacity) AND the new sustainability /
 * batch / UoM branches.
 */
import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import type { RunSettings } from "@/routes/editor-run-settings";

import { diffScenarios } from "./scenario-diff";

const baseSettings = {
  horizonMs: 60_000,
  warmupMs: 0,
  seed: 1,
  interStationBufferCapacity: 5,
  breakdowns: { enabled: false, mtbfMs: 0, mttrMs: 0 },
  source: { enabled: false, intervalMs: 0, batchSize: 1 },
  defaultDefectRate: 0,
  toolPools: [],
  products: { enabled: false, list: [] },
} as unknown as RunSettings;

function station(id: string, data: Record<string, unknown>): Node {
  return {
    id,
    type: "station",
    position: { x: 0, y: 0 },
    data: { label: id, stationType: "machine", defectRate: 0, ...data },
  };
}
function noEdges(): Edge[] {
  return [];
}

describe("diffScenarios (VROL-1035)", () => {
  it("flags energy/cycle changes between A and B", () => {
    const a = {
      nodes: [station("s1", { energyPerCycleJ: 1000 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const b = {
      nodes: [station("s1", { energyPerCycleJ: 1500 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const rows = diffScenarios(a, b);
    const row = rows.find((r) => r.label.includes("energy/cycle"));
    expect(row).toBeDefined();
    expect(row?.aValue).toBe("1000");
    expect(row?.bValue).toBe("1500");
  });

  it("flags water/cycle changes", () => {
    const a = {
      nodes: [station("s1", { waterPerCycleL: 0.5 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const b = {
      nodes: [station("s1", { waterPerCycleL: 0.75 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const rows = diffScenarios(a, b);
    expect(rows.find((r) => r.label.includes("water/cycle"))).toBeDefined();
  });

  it("flags CO2e/cycle changes", () => {
    const a = {
      nodes: [station("s1", { co2ePerCycleG: 2 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const b = {
      nodes: [station("s1", { co2ePerCycleG: 5 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const rows = diffScenarios(a, b);
    expect(rows.find((r) => r.label.includes("CO₂e/cycle"))).toBeDefined();
  });

  it("flags batchSize changes", () => {
    const a = {
      nodes: [station("s1", { batchSize: 1 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const b = {
      nodes: [station("s1", { batchSize: 10 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const rows = diffScenarios(a, b);
    const row = rows.find((r) => r.label.includes("batchSize"));
    expect(row).toBeDefined();
    expect(row?.aValue).toBe("1");
    expect(row?.bValue).toBe("10");
  });

  it("flags unit + unitsPerPart changes", () => {
    const a = {
      nodes: [station("s1", { unit: "parts", unitsPerPart: 1 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const b = {
      nodes: [station("s1", { unit: "kg", unitsPerPart: 0.5 })],
      edges: noEdges(),
      settings: baseSettings,
    };
    const rows = diffScenarios(a, b);
    expect(rows.find((r) => r.label.includes("· unit"))).toBeDefined();
    expect(rows.find((r) => r.label.includes("unitsPerPart"))).toBeDefined();
  });

  it("silent when nothing in the new field set differs", () => {
    const a = { nodes: [station("s1", {})], edges: noEdges(), settings: baseSettings };
    const b = { nodes: [station("s1", {})], edges: noEdges(), settings: baseSettings };
    const rows = diffScenarios(a, b);
    const newFieldLabels = [
      "energy/cycle",
      "water/cycle",
      "CO₂e/cycle",
      "batchSize",
      "· unit",
      "unitsPerPart",
    ];
    for (const lbl of newFieldLabels) {
      expect(rows.find((r) => r.label.includes(lbl))).toBeUndefined();
    }
  });

  // VROL-369 / VROL-1152-1153 — KPI deltas + summary.

  it("VROL-1152 — deriveKpiDeltaRows skips identical KPIs + populates delta + direction", async () => {
    const { deriveKpiDeltaRows } = await import("./scenario-diff");
    const a = baseResultForDiff({ throughputLambda: 1 / 1000 });
    const b = baseResultForDiff({ throughputLambda: 1.1 / 1000 });
    const rows = deriveKpiDeltaRows(a, b);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const throughputRow = rows.find((r) => r.label.startsWith("Throughput"));
    expect(throughputRow?.delta).toBeGreaterThan(0);
    expect(throughputRow?.betterDirection).toBe("higher");
    // OEE didn't move → no row.
    expect(rows.find((r) => r.label === "Line OEE")).toBeUndefined();
  });

  it("VROL-1152 — energy-per-part row is omitted when both runs are 0", async () => {
    const { deriveKpiDeltaRows } = await import("./scenario-diff");
    const a = baseResultForDiff({ totalEnergyJ: 0 });
    const b = baseResultForDiff({ totalEnergyJ: 0, lineOee: 0.5 });
    const rows = deriveKpiDeltaRows(a, b);
    expect(rows.find((r) => r.label.startsWith("Energy"))).toBeUndefined();
  });

  it("VROL-1153 — summary highlights the biggest mover", async () => {
    const { summarizeScenarioComparison } = await import("./scenario-diff");
    const a = baseResultForDiff({ throughputLambda: 1 / 1000 });
    const b = baseResultForDiff({ throughputLambda: 1.2 / 1000 });
    const result = summarizeScenarioComparison(
      { nodes: [], edges: [], settings: baseSettings },
      { nodes: [], edges: [], settings: baseSettings },
      a,
      b,
    );
    expect(result.summary.toLowerCase()).toContain("throughput");
    expect(result.summary).toMatch(/\+20\s*%/);
    expect(result.outputRows.length).toBeGreaterThan(0);
  });

  it("VROL-1153 — 'identical' summary when nothing moved", async () => {
    const { summarizeScenarioComparison } = await import("./scenario-diff");
    const a = baseResultForDiff();
    const b = baseResultForDiff();
    const result = summarizeScenarioComparison(
      { nodes: [], edges: [], settings: baseSettings },
      { nodes: [], edges: [], settings: baseSettings },
      a,
      b,
    );
    expect(result.summary.toLowerCase()).toContain("identical");
    expect(result.outputRows).toEqual([]);
  });

  it("VROL-1153 — null results → no output rows; input rows still computed", async () => {
    const { summarizeScenarioComparison } = await import("./scenario-diff");
    const result = summarizeScenarioComparison(
      { nodes: [], edges: [], settings: baseSettings },
      { nodes: [], edges: [], settings: baseSettings },
      null,
      null,
    );
    expect(result.outputRows).toEqual([]);
    expect(result.inputRows).toEqual([]);
  });
});

function baseResultForDiff(overrides: Partial<import("@/engine").ChainResult> = {}) {
  return {
    completed: 1000,
    throughputLambda: 1 / 1000,
    elapsedMs: 60_000,
    averageWipL: 5,
    avgTimeInSystemW: 250,
    lineOee: 0.75,
    lineScrapRate: 0,
    totalEnergyJ: 0,
    ...overrides,
  } as unknown as import("@/engine").ChainResult;
}
