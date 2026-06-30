/**
 * VROL-366 / VROL-1156 — run-history-ops tests.
 */
import { describe, expect, it } from "vitest";

import {
  consecutiveRunDeltas,
  filterRunHistory,
  type RunHistorySortOrder,
} from "./run-history-ops";
import type { RunHistoryEntryWithScenario } from "./run-history";

function entry(
  scenarioName: string,
  runAtMs: number,
  partial: Partial<RunHistoryEntryWithScenario> = {},
): RunHistoryEntryWithScenario {
  return {
    scenarioName,
    runAtMs,
    completed: 100,
    throughputLambda: 1 / 1000,
    lineOee: 0.7,
    avgTimeInSystemW: 500,
    ...partial,
  } as RunHistoryEntryWithScenario;
}

describe("filterRunHistory (VROL-1154)", () => {
  const sample = [
    entry("Bottling line", Date.UTC(2026, 5, 30), { bottleneckLabel: "Filler" }),
    entry("Bakery", Date.UTC(2026, 5, 29), { bottleneckLabel: "Oven" }),
    entry("Pharma", Date.UTC(2026, 5, 28), { bottleneckLabel: "Filler", lineOee: 0.4 }),
  ];

  it("returns all entries when query is empty (default sort = recent)", () => {
    const r = filterRunHistory(sample, "");
    expect(r.map((e) => e.scenarioName)).toEqual(["Bottling line", "Bakery", "Pharma"]);
  });

  it("filters by scenario name (case-insensitive)", () => {
    const r = filterRunHistory(sample, "BAKERY");
    expect(r.map((e) => e.scenarioName)).toEqual(["Bakery"]);
  });

  it("filters by bottleneck label", () => {
    const r = filterRunHistory(sample, "filler");
    expect(r).toHaveLength(2);
    expect(r.every((e) => e.bottleneckLabel === "Filler")).toBe(true);
  });

  it("filters by ISO date substring", () => {
    const r = filterRunHistory(sample, "2026-06-29");
    expect(r.map((e) => e.scenarioName)).toEqual(["Bakery"]);
  });

  it("sorts by throughput descending when requested", () => {
    const withTput = [
      entry("Low", Date.UTC(2026, 0, 1), { throughputLambda: 0.001 }),
      entry("High", Date.UTC(2026, 0, 2), { throughputLambda: 0.005 }),
      entry("Mid", Date.UTC(2026, 0, 3), { throughputLambda: 0.003 }),
    ];
    const r = filterRunHistory(withTput, "", "throughput-desc" as RunHistorySortOrder);
    expect(r.map((e) => e.scenarioName)).toEqual(["High", "Mid", "Low"]);
  });

  it("sorts by OEE descending when requested", () => {
    const r = filterRunHistory(sample, "", "oee-desc");
    expect(r.map((e) => e.scenarioName)).toEqual(["Bottling line", "Bakery", "Pharma"]);
  });
});

describe("consecutiveRunDeltas (VROL-1155)", () => {
  it("returns empty for empty / single-entry input", () => {
    expect(consecutiveRunDeltas([])).toEqual([]);
    expect(consecutiveRunDeltas([entry("a", 1)])).toEqual([]);
  });

  it("computes per-pair deltas in order", () => {
    const ent = [
      entry("first", 100, { throughputLambda: 0.001, lineOee: 0.5 }),
      entry("second", 200, { throughputLambda: 0.002, lineOee: 0.6 }),
      entry("third", 300, { throughputLambda: 0.0015, lineOee: 0.7 }),
    ];
    const deltas = consecutiveRunDeltas(ent);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]?.prev.scenarioName).toBe("first");
    expect(deltas[0]?.curr.scenarioName).toBe("second");
    expect(deltas[0]?.deltas.throughputLambdaDelta).toBeCloseTo(0.001, 6);
    expect(deltas[0]?.deltas.lineOeeDelta).toBeCloseTo(0.1, 6);
    expect(deltas[0]?.deltas.elapsedMsDelta).toBe(100);
    expect(deltas[1]?.deltas.throughputLambdaDelta).toBeCloseTo(-0.0005, 6);
  });
});
