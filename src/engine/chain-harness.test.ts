/**
 * Tests for the materials extension to runChain (VROL-575).
 *
 * The harness-wide Little's-Law / throughput tests live in kpi.test.ts; this
 * file focuses on the material-consumption + replenishment behavior.
 */

import { describe, expect, it } from "vitest";

import { runChain } from "./chain-harness";
import { constant } from "./distribution";
import { asMaterialId } from "./ids";
import { SeededPrng } from "./prng";

const BOTTLES = asMaterialId("bottles");
const CAPS = asMaterialId("caps");

describe("runChain — materials (VROL-575)", () => {
  it("consumes per-part materials at the configured station", () => {
    // 3-station chain. Capper (index 1) consumes 1 bottle + 1 cap per part.
    // 100ms cycle, 60s horizon → ~600 parts. Generous inventory so no starvation.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      materials: {
        initialInventory: [
          [BOTTLES, 10_000],
          [CAPS, 10_000],
        ],
        stationRecipes: [
          {
            stationIndex: 1, // Capper
            requirements: [
              { materialId: BOTTLES, qtyPerPart: 1 },
              { materialId: CAPS, qtyPerPart: 1 },
            ],
          },
        ],
      },
    });

    // Some parts completed
    expect(result.completed).toBeGreaterThan(100);
    // Materials decreased — and by the same amount, since both consumed per cycle
    expect(result.materialFinal).toBeDefined();
    const finalByMat = new Map(result.materialFinal ?? []);
    const finalBottles = finalByMat.get(BOTTLES);
    const finalCaps = finalByMat.get(CAPS);
    expect(finalBottles).toBeLessThan(10_000);
    expect(finalCaps).toBeLessThan(10_000);
    expect(finalBottles).toBe(finalCaps);
    // No replenishments configured
    expect(result.replenishmentsFired).toBe(0);
  });

  it("starves on material depletion when no replenishment is scheduled", () => {
    // Only 5 bottles → Capper can only finish 5 cycles, then starves on material.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      materials: {
        initialInventory: [
          [BOTTLES, 5],
          [CAPS, 100],
        ],
        stationRecipes: [
          {
            stationIndex: 1,
            requirements: [{ materialId: BOTTLES, qtyPerPart: 1 }],
          },
        ],
      },
    });

    expect(result.completed).toBeLessThanOrEqual(5);
    // Material depleted to zero
    const finalByMat = new Map(result.materialFinal ?? []);
    expect(finalByMat.get(BOTTLES)).toBe(0);
    // Capper should show non-zero starvation time
    const capper = result.bottlenecks.find((b) => b.label === "Capper");
    expect(capper).toBeDefined();
    const starved = capper!.breakdown.find((b) => b.state === "Starved")?.pct ?? 0;
    expect(starved).toBeGreaterThan(0);
  });

  it("recovers throughput when a scheduled replenishment arrives mid-run", () => {
    // 5 bottles to start, then replenish +1000 at 5 seconds. Capper should
    // starve briefly then resume.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      materials: {
        initialInventory: [[BOTTLES, 5]],
        stationRecipes: [
          {
            stationIndex: 1,
            requirements: [{ materialId: BOTTLES, qtyPerPart: 1 }],
          },
        ],
        replenishments: [{ materialId: BOTTLES, amount: 1000, atMs: 5_000 }],
      },
    });

    expect(result.replenishmentsFired).toBe(1);
    // Without replenishment we'd cap at ~5 parts; with it we should run far more.
    expect(result.completed).toBeGreaterThan(50);
    // The replenishment was consumed during the rest of the run.
    const finalBottles = new Map(result.materialFinal ?? []).get(BOTTLES) ?? 0;
    expect(finalBottles).toBeLessThan(1000); // most bottles consumed
  });

  it("ignores material-replenishment events for unknown materials gracefully", () => {
    const UNKNOWN = asMaterialId("unknown");
    // No starvation case — just verify the harness doesn't blow up when a
    // replenishment lands for a material no station consumes.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      materials: {
        initialInventory: [[BOTTLES, 10_000]],
        stationRecipes: [
          {
            stationIndex: 1,
            requirements: [{ materialId: BOTTLES, qtyPerPart: 1 }],
          },
        ],
        replenishments: [{ materialId: UNKNOWN, amount: 50, atMs: 2_000 }],
      },
    });
    expect(result.replenishmentsFired).toBe(1);
    expect(result.completed).toBeGreaterThan(0);
  });

  it("returns no materialFinal field when materials config is omitted", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    });
    expect(result.materialFinal).toBeUndefined();
    expect(result.replenishmentsFired).toBeUndefined();
  });
});
