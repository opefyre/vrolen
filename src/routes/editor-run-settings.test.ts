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
      },
    });
    expect(merged.materials.enabled).toBe(true);
    expect(merged.materials.bottles).toBe(50);
    expect(merged.materials.replenishment.atMs).toBe(0);
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

  it("merges breakdowns independently", () => {
    const merged = mergeWithDefaults({
      breakdowns: { enabled: true, mtbfMs: 8_000, mttrMs: 1_500 },
    });
    expect(merged.breakdowns.enabled).toBe(true);
    expect(merged.breakdowns.mtbfMs).toBe(8_000);
    expect(merged.breakdowns.mttrMs).toBe(1_500);
    expect(merged.materials.enabled).toBe(DEFAULT_RUN_SETTINGS.materials.enabled);
  });
});
