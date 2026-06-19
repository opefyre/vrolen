import { describe, expect, it } from "vitest";

import { DEFAULT_RUN_SETTINGS, mergeWithDefaults } from "./editor-run-settings";

describe("editor-run-settings — mergeWithDefaults", () => {
  it("returns defaults for an empty partial", () => {
    expect(mergeWithDefaults({})).toEqual(DEFAULT_RUN_SETTINGS);
  });

  it("preserves top-level fields the caller provided", () => {
    const merged = mergeWithDefaults({ horizonMs: 30_000, seed: 42 });
    expect(merged.horizonMs).toBe(30_000);
    expect(merged.seed).toBe(42);
    expect(merged.warmupMs).toBe(DEFAULT_RUN_SETTINGS.warmupMs);
  });

  it("merges materials with their nested replenishment defaults", () => {
    const merged = mergeWithDefaults({
      materials: {
        enabled: true,
        bottles: 50,
        caps: 50,
        replenishment: { enabled: false, atMs: 0, amount: 0 },
        recurring: [],
      },
    });
    expect(merged.materials.enabled).toBe(true);
    expect(merged.materials.bottles).toBe(50);
    expect(merged.materials.replenishment.atMs).toBe(0);
  });

  it("preserves valid recurring delivery rows + drops malformed ones (VROL-643)", () => {
    const merged = mergeWithDefaults({
      materials: {
        enabled: true,
        bottles: 0,
        caps: 0,
        replenishment: { enabled: false, atMs: 0, amount: 0 },
        recurring: [
          { material: "bottles", amount: 50, intervalMs: 60_000 },
          { material: "caps", amount: 10, intervalMs: 30_000, maxInventory: 100 },
          // Malformed: drops the row, not the array.
          { material: "bottles", amount: -1, intervalMs: 1_000 } as unknown as never,
          "garbage" as unknown as never,
        ],
      },
    });
    expect(merged.materials.recurring).toHaveLength(3);
    // The negative amount got clamped to 0 (no-op replenishment, still kept).
    expect(merged.materials.recurring[2]).toEqual({
      material: "bottles",
      amount: 0,
      intervalMs: 1_000,
    });
    // Pure garbage was dropped.
    expect(merged.materials.recurring).not.toContain("garbage");
  });

  it("falls back to default replenishment shape when materials lacks one", () => {
    const merged = mergeWithDefaults({
      materials: { enabled: true } as never, // simulates partial old data missing replenishment
    });
    expect(merged.materials.enabled).toBe(true);
    expect(merged.materials.bottles).toBe(DEFAULT_RUN_SETTINGS.materials.bottles);
    expect(merged.materials.replenishment.enabled).toBe(
      DEFAULT_RUN_SETTINGS.materials.replenishment.enabled,
    );
  });

  it("merges source defaults when missing + sanitizes when present (VROL-651)", () => {
    // Pre-VROL-651 payload (no source field) hydrates to defaults.
    const m1 = mergeWithDefaults({ horizonMs: 60_000 });
    expect(m1.source).toEqual({ enabled: false, intervalMs: 60_000, batchSize: 1 });
    // Present but partial / malformed values clamp safely.
    const m2 = mergeWithDefaults({
      source: { enabled: true, intervalMs: -100, batchSize: 0 } as never,
    });
    expect(m2.source.enabled).toBe(true);
    expect(m2.source.intervalMs).toBe(60_000); // negative → default
    expect(m2.source.batchSize).toBe(1); // 0 → default
    // Well-formed payload round-trips intact.
    const m3 = mergeWithDefaults({
      source: { enabled: true, intervalMs: 30_000, batchSize: 5 },
    });
    expect(m3.source).toEqual({ enabled: true, intervalMs: 30_000, batchSize: 5 });
  });

  it("merges breakdowns independently", () => {
    const merged = mergeWithDefaults({
      breakdowns: { enabled: true, mtbfMs: 8_000, mttrMs: 1_500 },
    });
    expect(merged.breakdowns.enabled).toBe(true);
    expect(merged.breakdowns.mtbfMs).toBe(8_000);
    expect(merged.breakdowns.mttrMs).toBe(1_500);
    expect(merged.materials.enabled).toBe(DEFAULT_RUN_SETTINGS.materials.enabled);
  });

  it("migrates legacy workers payload (count + shared skills + shiftEndMs) into list (VROL-587)", () => {
    const merged = mergeWithDefaults({
      workers: { enabled: true, count: 3, skills: ["qc"], shiftEndMs: 30_000, list: [] },
    });
    expect(merged.workers.enabled).toBe(true);
    expect(merged.workers.list).toHaveLength(3);
    expect(merged.workers.list[0]?.name).toBe("Worker 1");
    expect(merged.workers.list[0]?.skills).toEqual(["qc"]);
    expect(merged.workers.list[0]?.shiftEndMs).toBe(30_000);
  });

  it("animateFlow defaults to false and round-trips when set", () => {
    const def = mergeWithDefaults({});
    expect(def.animateFlow).toBe(false);
    const set = mergeWithDefaults({ animateFlow: true });
    expect(set.animateFlow).toBe(true);
  });

  it("preserves valid per-worker breaks through mergeWithDefaults (VROL-617)", () => {
    const merged = mergeWithDefaults({
      workers: {
        enabled: true,
        list: [
          {
            name: "Alice",
            skills: ["any"],
            shiftEndMs: 60_000,
            breaks: [{ startMs: 10_000, endMs: 20_000 }],
          },
        ],
      },
    });
    expect(merged.workers.list[0]?.breaks).toEqual([{ startMs: 10_000, endMs: 20_000 }]);
  });

  it("strips malformed breaks (non-objects, invalid bounds, end ≤ start)", () => {
    const merged = mergeWithDefaults({
      workers: {
        enabled: true,
        list: [
          {
            name: "Eve",
            skills: ["any"],
            shiftEndMs: 60_000,
            // Mix of valid + every kind of malformed entry mergeWithDefaults sees in the wild.
            breaks: [
              { startMs: 10_000, endMs: 20_000 }, // valid
              { startMs: 5_000, endMs: 5_000 }, // end == start
              { startMs: 30_000, endMs: 20_000 }, // end < start
              { startMs: -1, endMs: 5_000 }, // negative
              null as unknown as { startMs: number; endMs: number },
            ],
          },
        ],
      },
    });
    expect(merged.workers.list[0]?.breaks).toEqual([{ startMs: 10_000, endMs: 20_000 }]);
  });

  it("drops the breaks field entirely when no breaks survive sanitization", () => {
    const merged = mergeWithDefaults({
      workers: {
        enabled: true,
        list: [
          {
            name: "Bob",
            skills: ["any"],
            shiftEndMs: 60_000,
            breaks: [{ startMs: 5_000, endMs: 4_000 }],
          },
        ],
      },
    });
    expect(merged.workers.list[0]?.breaks).toBeUndefined();
  });

  it("samplerIntervalMs defaults to 0 (off) and round-trips a positive value (VROL-613)", () => {
    expect(mergeWithDefaults({}).samplerIntervalMs).toBe(0);
    expect(mergeWithDefaults({ samplerIntervalMs: 1_000 }).samplerIntervalMs).toBe(1_000);
    // Floors floats, clamps negative to default.
    expect(mergeWithDefaults({ samplerIntervalMs: 250.7 }).samplerIntervalMs).toBe(250);
    expect(mergeWithDefaults({ samplerIntervalMs: -100 }).samplerIntervalMs).toBe(0);
  });

  it("keeps an explicit workers.list as-is when provided", () => {
    const merged = mergeWithDefaults({
      workers: {
        enabled: true,
        list: [
          { name: "Alice", skills: ["filling"], shiftEndMs: 60_000 },
          { name: "Bob", skills: ["capping"], shiftEndMs: 60_000 },
        ],
      },
    });
    expect(merged.workers.list.map((w) => w.name)).toEqual(["Alice", "Bob"]);
    expect(merged.workers.list[1]?.skills).toEqual(["capping"]);
  });
});
