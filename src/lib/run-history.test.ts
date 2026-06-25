import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearAllForTests,
  addRun,
  clearRuns,
  listRecentRuns,
  listRuns,
  type RunHistoryEntry,
} from "./run-history";

const entry = (runAtMs: number, completed = 100): RunHistoryEntry => ({
  completed,
  throughputLambda: completed / 60_000,
  lineOee: 0.8,
  avgTimeInSystemW: 500,
  runAtMs,
});

beforeEach(() => {
  _clearAllForTests();
});

describe("run-history", () => {
  it("addRun + listRuns round-trip; newest first", () => {
    addRun("scenA", entry(100));
    addRun("scenA", entry(200, 110));
    addRun("scenA", entry(300, 120));
    const runs = listRuns("scenA");
    expect(runs).toHaveLength(3);
    expect(runs[0]?.runAtMs).toBe(300);
    expect(runs[2]?.runAtMs).toBe(100);
  });

  it("caps at 5 per scenario (FIFO eviction of oldest)", () => {
    for (let i = 1; i <= 8; i++) {
      addRun("scenB", entry(i * 100));
    }
    const runs = listRuns("scenB");
    expect(runs).toHaveLength(5);
    // Newest first: i=8 → first; oldest kept is i=4
    expect(runs[0]?.runAtMs).toBe(800);
    expect(runs[4]?.runAtMs).toBe(400);
  });

  it("scenarios are independent", () => {
    addRun("scenA", entry(100));
    addRun("scenB", entry(200));
    addRun("scenA", entry(150));
    expect(listRuns("scenA")).toHaveLength(2);
    expect(listRuns("scenB")).toHaveLength(1);
    expect(listRuns("scenC")).toEqual([]);
  });

  it("rejects empty scenario names silently (no-op)", () => {
    addRun("", entry(100));
    addRun("   ", entry(200));
    expect(listRuns("")).toEqual([]);
    expect(listRuns("   ")).toEqual([]);
  });

  it("payload round-trips through addRun + listRuns (VROL-611)", () => {
    const payload = {
      graph: { nodes: [], edges: [] },
      settings: {} as RunHistoryEntry["payload"] extends infer P
        ? P extends { settings: infer S }
          ? S
          : never
        : never,
    };
    addRun("scenP", { ...entry(100), payload });
    const runs = listRuns("scenP");
    expect(runs[0]?.payload).toBeDefined();
    expect(runs[0]?.payload?.graph.nodes).toEqual([]);
  });

  it("listRecentRuns flattens across scenarios newest-first with cap (VROL-674)", () => {
    addRun("a", entry(100));
    addRun("b", entry(300));
    addRun("a", entry(200));
    addRun("c", entry(500));
    const recent = listRecentRuns(3);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.runAtMs).toBe(500);
    expect(recent[0]?.scenarioName).toBe("c");
    expect(recent[1]?.runAtMs).toBe(300);
    expect(recent[2]?.runAtMs).toBe(200);
  });

  it("clearRuns removes the scenario's history", () => {
    addRun("scenA", entry(100));
    addRun("scenA", entry(200));
    clearRuns("scenA");
    expect(listRuns("scenA")).toEqual([]);
  });

  it("VROL-1026 — sustainability totals round-trip through the store", () => {
    addRun("scenSus", {
      ...entry(100),
      totalEnergyJ: 100_000,
      totalWaterL: 25,
      totalCO2eG: 500,
    });
    const runs = listRuns("scenSus");
    expect(runs[0]?.totalEnergyJ).toBe(100_000);
    expect(runs[0]?.totalWaterL).toBe(25);
    expect(runs[0]?.totalCO2eG).toBe(500);
  });

  it("VROL-1026 — sustainability totals are optional (back-compat)", () => {
    addRun("scenPlain", entry(100));
    const runs = listRuns("scenPlain");
    expect(runs[0]?.totalEnergyJ).toBeUndefined();
  });
});
