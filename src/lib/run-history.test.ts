import { beforeEach, describe, expect, it } from "vitest";

import {
  _clearAllForTests,
  addRun,
  clearRuns,
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

  it("clearRuns removes the scenario's history", () => {
    addRun("scenA", entry(100));
    addRun("scenA", entry(200));
    clearRuns("scenA");
    expect(listRuns("scenA")).toEqual([]);
  });
});
