import { beforeEach, describe, expect, it } from "vitest";

import type { ChainResult } from "@/engine";

import {
  _clearAllForTests,
  addComparison,
  type ComparisonEntry,
  listComparisons,
  removeComparison,
} from "./comparison-history";

function entry(id: string, savedAtMs: number): ComparisonEntry {
  return {
    id,
    savedAtMs,
    aName: "base",
    aResult: { completed: 100, perStationCapacity: [1] } as unknown as ChainResult,
    aStationLabels: ["A"],
    bName: "tuned",
    bResult: { completed: 150, perStationCapacity: [1] } as unknown as ChainResult,
    bStationLabels: ["A"],
    horizonMs: 60_000,
    warmupMs: 0,
  };
}

describe("comparison-history (VROL-654)", () => {
  beforeEach(() => {
    _clearAllForTests();
  });

  it("addComparison + listComparisons round-trips a single entry", () => {
    addComparison(entry("c1", 1));
    const list = listComparisons();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("c1");
    expect(list[0]?.aResult.completed).toBe(100);
  });

  it("caps to 5 most-recent (oldest evicted, newest first)", () => {
    for (let i = 1; i <= 7; i++) addComparison(entry(`c${String(i)}`, i));
    const list = listComparisons();
    expect(list).toHaveLength(5);
    // Newest first — c7, c6, c5, c4, c3.
    expect(list.map((e) => e.id)).toEqual(["c7", "c6", "c5", "c4", "c3"]);
  });

  it("removeComparison drops the matching entry without touching the rest", () => {
    addComparison(entry("c1", 1));
    addComparison(entry("c2", 2));
    addComparison(entry("c3", 3));
    removeComparison("c2");
    const list = listComparisons();
    expect(list.map((e) => e.id)).toEqual(["c3", "c1"]);
  });
});
