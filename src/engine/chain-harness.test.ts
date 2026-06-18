/**
 * Tests for the materials extension to runChain (VROL-575).
 *
 * The harness-wide Little's-Law / throughput tests live in kpi.test.ts; this
 * file focuses on the material-consumption + replenishment behavior.
 */

import { describe, expect, it } from "vitest";

import { runChain } from "./chain-harness";
import { constant } from "./distribution";
import { asMaterialId, asResourceId } from "./ids";
import { SeededPrng } from "./prng";

const exp = (rate: number) => ({ kind: "exponential" as const, rate });
const worker = (id: string, skills: readonly string[] = [], endMs = 1_000_000) => ({
  id: asResourceId(id),
  name: id,
  skills,
  shifts: [{ startMs: 0, endMs }],
});

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

describe("runChain — breakdowns (VROL-576)", () => {
  it("fires per-station breakdowns when MTBF + MTTR are configured", () => {
    // Aggressive MTBF (rate 1/2000 = mean 2s) over 60s horizon → many breakdowns expected.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xabc123),
      stationLabels: ["Filler", "Capper", "Labeler"],
      breakdowns: {
        mtbfMs: exp(1 / 2000),
        mttrMs: constant(500),
      },
    });

    expect(result.perStationBreakdowns).toBeDefined();
    const total = (result.perStationBreakdowns ?? []).reduce((a, b) => a + b, 0);
    // At ~2s MTBF over 60s, expect several breakdowns across 3 stations
    expect(total).toBeGreaterThan(3);
  });

  it("availability drops below baseline when breakdowns are enabled", () => {
    const common = {
      stationCycleTimes: [constant(100), constant(200), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      stationLabels: ["Filler", "Capper", "Labeler"],
    };
    const baseline = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
    });
    const withBreakdowns = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
      breakdowns: {
        mtbfMs: exp(1 / 3000),
        mttrMs: constant(1000),
      },
    });

    // Average availability across stations should drop noticeably
    const avgA = (oees: readonly { availability: number }[]) =>
      oees.reduce((s, m) => s + m.availability, 0) / oees.length;
    const baseAvailability = avgA(baseline.perStationOee);
    const breakdownAvailability = avgA(withBreakdowns.perStationOee);
    expect(breakdownAvailability).toBeLessThan(baseAvailability);
  });

  it("part-resume on repair preserves in-flight parts across a breakdown (VROL-125)", () => {
    // Single-station chain with a long cycle time. A breakdown fires shortly after
    // the cycle starts; once repaired, the part should still complete (no scrap).
    // Compare scrapped count vs. baseline (a run with the same fixture but no
    // breakdowns) — with part-resume on, scrapped should be ~0.
    const cycleMs = 1000;
    const common = {
      stationCycleTimes: [constant(cycleMs)],
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      stationLabels: ["S"],
    };
    const baseline = runChain({ ...common, prng: new SeededPrng(0xc0ffee) });
    const withBreakdowns = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
      breakdowns: {
        // Frequent breakdowns mid-cycle, fast repair.
        mtbfMs: { kind: "exponential", rate: 1 / 500 },
        mttrMs: constant(200),
      },
    });

    // Some breakdowns must have happened.
    expect(withBreakdowns.perStationBreakdowns).toBeDefined();
    const breakdownCount = (withBreakdowns.perStationBreakdowns ?? [0])[0] ?? 0;
    expect(breakdownCount).toBeGreaterThan(0);

    // Throughput should drop relative to baseline (breakdowns DO cost time), but
    // far less than a "scrap-on-breakdown" implementation: comparing total parts
    // produced before vs after, we should still complete plenty.
    expect(withBreakdowns.completed).toBeGreaterThan(baseline.completed * 0.4);
    // OEE Performance might not be perfect because cycles were paused, but it
    // shouldn't reflect a part-by-part scrap (which would crater Quality).
    expect(withBreakdowns.perStationOee[0]!.quality).toBe(1);
  });

  it("back-compat: no perStationBreakdowns field when breakdowns config omitted", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    });
    expect(result.perStationBreakdowns).toBeUndefined();
  });
});

describe("runChain — workers (VROL-580)", () => {
  it("back-compat: no laborUtilization field when workers config omitted", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    });
    expect(result.laborUtilization).toBeUndefined();
  });

  it("starves with no-skill-available when no qualified worker exists", () => {
    // 1 worker on shift but no skill match → all stations starve
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(),
      stationLabels: ["Filler", "Capper", "Labeler"],
      workers: {
        workers: [worker("w1", ["packaging"])], // no station requires packaging here
        requireDefault: ["assembly"], // every station needs assembly
      },
    });
    // Nothing should complete because no worker has the assembly skill
    expect(result.completed).toBe(0);
    // Labor utilization should be 0 because no worker was ever assigned
    expect(result.laborUtilization).toBe(0);
    // Some Starved time should be recorded on every station
    for (const oee of result.perStationOee) {
      expect(oee.runTimeMs).toBe(0);
    }
  });

  it("with 1 worker + 3 stations the chain is rate-limited by labor availability", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      workers: {
        workers: [worker("w1", ["any"])],
        requireDefault: ["any"],
      },
    });
    expect(result.laborUtilization).toBeDefined();
    // With 1 worker, at any moment ≤1 station runs → labor utilization
    // approaches 1.0 as the chain stays busy. Allow generous tolerance for
    // setup / scheduling gaps.
    expect(result.laborUtilization!).toBeGreaterThan(0.7);
    expect(result.laborUtilization!).toBeLessThanOrEqual(1);
  });

  it("with workers >= stations the chain runs at normal throughput", () => {
    const common = {
      stationCycleTimes: [constant(100), constant(200), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      stationLabels: ["Filler", "Capper", "Labeler"],
    };
    const baseline = runChain({ ...common, prng: new SeededPrng(0xc0ffee) });
    const withWorkers = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
      workers: {
        workers: [worker("w1", ["any"]), worker("w2", ["any"]), worker("w3", ["any"])],
        requireDefault: ["any"],
      },
    });
    // 3 workers + 3 stations → no labor bottleneck → throughput matches baseline
    expect(withWorkers.completed).toBeGreaterThanOrEqual(baseline.completed - 1);
    expect(withWorkers.completed).toBeLessThanOrEqual(baseline.completed + 1);
  });

  it("per-station skills route only matching workers (subset rule)", () => {
    // Station 0 needs "filling", station 1 needs "capping", station 2 needs nothing.
    // Worker w1 only has "filling" → station 1 starves (no capping worker).
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(0xabcdef),
      stationLabels: ["Filler", "Capper", "Labeler"],
      workers: {
        workers: [worker("w1", ["filling"])],
        perStationSkills: [["filling"], ["capping"], []],
        requireDefault: [],
      },
    });
    // Station 0 (filling) runs; station 1 (capping) cannot proceed; nothing exits the sink.
    expect(result.completed).toBe(0);
    // Station 0 should have non-zero completed (parts produced into the inter-buffer)
    expect(result.perStationCompleted[0]).toBeGreaterThan(0);
    expect(result.perStationCompleted[1]).toBe(0);
  });

  it("a worker with union skills satisfies multiple stations", () => {
    // Station 0 needs "filling", station 1 needs "capping". Worker has BOTH.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(0xabcdef),
      stationLabels: ["Filler", "Capper", "Labeler"],
      workers: {
        workers: [worker("multi", ["filling", "capping"])],
        perStationSkills: [["filling"], ["capping"], []],
        requireDefault: [],
      },
    });
    // Chain should produce parts at the sink — both skill requirements are satisfied
    // by the same union-skilled worker.
    expect(result.completed).toBeGreaterThan(0);
  });

  it("starves after the shift window closes", () => {
    // Single worker, shift ends at 2 seconds. After that no station can run.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      workers: {
        workers: [worker("w1", ["any"], 2_000)], // shift ends at 2s
        requireDefault: ["any"],
      },
    });
    // Worker is on shift for ~2s; after that no progress. Labor util should
    // be ~2s / (1 worker × 10s) = 0.2 (with some scheduling jitter).
    expect(result.laborUtilization).toBeDefined();
    expect(result.laborUtilization!).toBeGreaterThan(0.1);
    expect(result.laborUtilization!).toBeLessThan(0.3);
  });
});

describe("runChain — line OEE (VROL-610)", () => {
  it("balanced chain at theoretical capacity → lineOee close to 1.0", () => {
    // All stations same cycle, no breakdowns / defects. The chain should
    // operate at ~100% of theoretical throughput after warmup.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["A", "B", "C"],
    });
    expect(result.lineOee).toBeGreaterThan(0.95);
    expect(result.lineOee).toBeLessThanOrEqual(1.0);
  });

  it("bottleneckStationIdx points to the slowest station", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(200), constant(50)],
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
    });
    expect(result.bottleneckStationIdx).toBe(1);
    // throughput ≈ 1/200ms; bottleneck cycle = 200 → OEE ≈ 1.0 for steady
    // state at the bottleneck rate.
    expect(result.lineOee).toBeGreaterThan(0.9);
  });

  it("breakdowns drag lineOee below 1.0", () => {
    const common = {
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      stationLabels: ["A", "B", "C"],
    };
    const baseline = runChain({ ...common, prng: new SeededPrng(0xc0ffee) });
    const withBreakdowns = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
      breakdowns: {
        mtbfMs: { kind: "exponential", rate: 1 / 5_000 },
        mttrMs: constant(500),
      },
    });
    expect(withBreakdowns.lineOee).toBeLessThan(baseline.lineOee);
  });
});

describe("runChain — maintenance (VROL-589)", () => {
  it("station enters Maintenance during the configured window and exits at the end", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      stationLabels: ["Filler", "Capper", "Labeler"],
      maintenance: {
        perStationWindows: new Map([[1, [{ startMs: 5_000, endMs: 10_000 }]]]),
      },
    });
    expect(result.perStationMaintenanceMs).toBeDefined();
    const capperMaint = result.perStationMaintenanceMs?.[1] ?? 0;
    expect(capperMaint).toBeGreaterThan(4_500);
    expect(capperMaint).toBeLessThan(5_500);
  });

  it("part-resume across maintenance keeps Quality at 1.0 (no scrap)", () => {
    const result = runChain({
      stationCycleTimes: [constant(1000)],
      interStationBufferCapacity: 10,
      horizonMs: 20_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      maintenance: {
        // Several short windows mid-cycle
        perStationWindows: new Map([
          [
            0,
            [
              { startMs: 300, endMs: 600 },
              { startMs: 2_500, endMs: 3_000 },
              { startMs: 6_400, endMs: 6_800 },
            ],
          ],
        ]),
      },
    });
    // Should still produce parts; none should be scrapped (defectRate=0 + part-resume)
    expect(result.completed).toBeGreaterThan(10);
    expect(result.perStationOee[0]!.quality).toBe(1);
  });

  it("no maintenance field when no windows configured", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    });
    expect(result.perStationMaintenanceMs).toBeUndefined();
  });
});

describe("runChain — defect rate KPI (VROL-591)", () => {
  it("perStationScrapped is always present + matches executor scrap counts", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    });
    expect(result.perStationScrapped).toHaveLength(2);
    expect(result.perStationScrapped.every((n) => n === 0)).toBe(true);
    expect(result.lineScrapRate).toBe(0);
  });
});

describe("runChain — multi-product mix (VROL-594)", () => {
  it("samples products at the source according to the configured weights", () => {
    // 60/40 A/B mix; over many parts the observed ratio should match within ~5%.
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50), constant(50)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xdeadbeef),
      products: {
        products: [
          { id: "A", weight: 60 },
          { id: "B", weight: 40 },
        ],
      },
    });
    expect(result.perProductCompleted).toBeDefined();
    const a = result.perProductCompleted!.get("A") ?? 0;
    const b = result.perProductCompleted!.get("B") ?? 0;
    expect(a + b).toBeGreaterThan(0);
    const total = a + b;
    expect(Math.abs(a / total - 0.6)).toBeLessThan(0.05);
    expect(Math.abs(b / total - 0.4)).toBeLessThan(0.05);
  });

  it("single-product back-compat: omitting products produces no perProductCompleted field", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    });
    expect(result.perProductCompleted).toBeUndefined();
  });

  it("per-product cycle differentiation: 100% B at 4x cycle produces 4x fewer parts than 100% A", () => {
    // Same station, two runs. The only difference is which single-product mix
    // is fed in. Throughput should scale inversely with cycle time.
    const common = {
      topology: {
        nodes: [
          {
            id: "s0",
            cycleTimeMs: constant(100),
            cycleByProduct: {
              A: constant(100),
              B: constant(400),
            },
          },
        ],
        edges: [] as { source: string; target: string }[],
      },
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
    };
    const runA = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
      products: { products: [{ id: "A", weight: 1 }] },
    });
    const runB = runChain({
      ...common,
      prng: new SeededPrng(0xc0ffee),
      products: { products: [{ id: "B", weight: 1 }] },
    });
    // A at 100ms over 60s ≈ 600 parts; B at 400ms over 60s ≈ 150 parts.
    // Ratio (A / B) should be ~4.
    expect(runA.completed).toBeGreaterThan(runB.completed * 3);
    expect(runA.completed).toBeLessThan(runB.completed * 5);
  });

  it("cycleByProduct falls back to cycleTimeMs when no matching productId", () => {
    // Source emits a single 'X' product, but the cycleByProduct map only has 'Y'.
    // Should fall back to cycleTimeMs (100ms) and produce normally.
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "s0",
            cycleTimeMs: constant(100),
            cycleByProduct: { Y: constant(10) },
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
      products: { products: [{ id: "X", weight: 1 }] },
    });
    // Single station, no sink — completed counts as exit from the single node.
    expect(result.completed).toBeGreaterThan(0);
  });

  it("changeover matrix: cross-product transition pays the matrix cost (VROL-597)", () => {
    // 50/50 mix; same-product A→A and B→B cost 0; cross-product A→B and B→A
    // cost 500ms each. Compare to a baseline run with no changeover matrix
    // (everything at default 0ms setup).
    const common = {
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      products: {
        products: [
          { id: "A", weight: 1 },
          { id: "B", weight: 1 },
        ],
      },
    };
    const baseline = runChain({
      ...common,
      prng: new SeededPrng(0xcafebabe),
      topology: {
        nodes: [{ id: "s0", cycleTimeMs: constant(100) }],
        edges: [],
      },
    });
    const withMatrix = runChain({
      ...common,
      prng: new SeededPrng(0xcafebabe),
      topology: {
        nodes: [
          {
            id: "s0",
            cycleTimeMs: constant(100),
            changeoverMatrix: {
              A: { B: constant(500) },
              B: { A: constant(500) },
            },
          },
        ],
        edges: [],
      },
    });
    // Cross-product setup cost should slow throughput
    expect(withMatrix.completed).toBeLessThan(baseline.completed);
    expect(withMatrix.completed).toBeGreaterThan(baseline.completed * 0.3);
  });

  it("changeover matrix: same-product transitions stay fast", () => {
    // Same matrix, but the mix is 100% A → A→A transitions only → no cost.
    const result = runChain({
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(0xcafebabe),
      products: { products: [{ id: "A", weight: 1 }] },
      topology: {
        nodes: [
          {
            id: "s0",
            cycleTimeMs: constant(100),
            changeoverMatrix: {
              A: { B: constant(500) },
              B: { A: constant(500) },
            },
          },
        ],
        edges: [],
      },
    });
    // Same-product never hits the matrix; throughput approximates 1/cycleMs
    expect(result.completed).toBeGreaterThan(280); // 30000/100 = 300, allow some slack
  });

  it("three-product mix sums to total completion at the sink", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(0xfeedface),
      products: {
        products: [
          { id: "X", weight: 1 },
          { id: "Y", weight: 1 },
          { id: "Z", weight: 1 },
        ],
      },
    });
    const summed = [...result.perProductCompleted!.values()].reduce((s, n) => s + n, 0);
    expect(summed).toBe(result.completed);
  });
});

describe("runChain — DAG topology (VROL-582)", () => {
  it("topology mode reproduces a linear chain identically to stationCycleTimes mode", () => {
    const base = {
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      stationLabels: ["Filler", "Capper", "Labeler"],
    };
    const linear = runChain({
      ...base,
      stationCycleTimes: [constant(100), constant(200), constant(100)],
      prng: new SeededPrng(0xc0ffee),
    });
    const dag = runChain({
      ...base,
      topology: {
        nodes: [
          { id: "a", label: "Filler", cycleTimeMs: constant(100) },
          { id: "b", label: "Capper", cycleTimeMs: constant(200) },
          { id: "c", label: "Labeler", cycleTimeMs: constant(100) },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ],
      },
      prng: new SeededPrng(0xc0ffee),
    });
    expect(dag.completed).toBe(linear.completed);
    expect(dag.perStationCompleted).toEqual(linear.perStationCompleted);
  });

  it("diamond fixture (Filler → [QC1, QC2] → Packer) runs both branches", () => {
    // Two QC stations in parallel; total throughput should be ~2x a single 200ms station
    // (subject to source / sink bottlenecks).
    const result = runChain({
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      topology: {
        nodes: [
          { id: "filler", label: "Filler", cycleTimeMs: constant(50) },
          { id: "qc1", label: "QC1", cycleTimeMs: constant(200) },
          { id: "qc2", label: "QC2", cycleTimeMs: constant(200) },
          { id: "packer", label: "Packer", cycleTimeMs: constant(50) },
        ],
        edges: [
          { source: "filler", target: "qc1" },
          { source: "filler", target: "qc2" },
          { source: "qc1", target: "packer" },
          { source: "qc2", target: "packer" },
        ],
      },
    });
    // Both QC stations should have non-zero throughput
    const perStation = result.perStationCompleted;
    expect(perStation[0]).toBeGreaterThan(0); // filler
    expect(perStation[1]).toBeGreaterThan(0); // qc1
    expect(perStation[2]).toBeGreaterThan(0); // qc2
    expect(perStation[3]).toBeGreaterThan(0); // packer
    // Filler must have at least as many completed as QC1+QC2 combined (it feeds them)
    expect(perStation[0]).toBeGreaterThanOrEqual((perStation[1] ?? 0) + (perStation[2] ?? 0) - 1);
    // Total at packer should be roughly 2x what a single 200ms station could do over 60s
    // (single 200ms station = 300 parts/min; diamond should approach 600)
    expect(result.completed).toBeGreaterThan(450); // generous lower bound
  });

  it("rejects a topology with no source (every node has an incoming edge)", () => {
    expect(() =>
      runChain({
        interStationBufferCapacity: 10,
        horizonMs: 10_000,
        warmupMs: 0,
        prng: new SeededPrng(),
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(100) },
            { id: "b", cycleTimeMs: constant(100) },
          ],
          edges: [
            { source: "a", target: "b" },
            { source: "b", target: "a" },
          ],
        },
      }),
    ).toThrow(/cycle|source/);
  });

  it("rejects a topology with multiple sources", () => {
    expect(() =>
      runChain({
        interStationBufferCapacity: 10,
        horizonMs: 10_000,
        warmupMs: 0,
        prng: new SeededPrng(),
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(100) },
            { id: "b", cycleTimeMs: constant(100) },
            { id: "c", cycleTimeMs: constant(100) },
          ],
          edges: [
            { source: "a", target: "c" },
            { source: "b", target: "c" }, // a + b are both sources
          ],
        },
      }),
    ).toThrow(/source/);
  });

  it("per-node setup time is honored on a DAG node (VROL-586)", () => {
    // Diamond fixture; QC1 has a 100ms setup before every cycle, QC2 does not.
    // Expected: QC1 completes fewer parts than QC2 given the same cycle time.
    const result = runChain({
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      topology: {
        nodes: [
          { id: "src", cycleTimeMs: constant(50) },
          {
            id: "qc1",
            cycleTimeMs: constant(200),
            setupTimeMs: constant(100),
          },
          { id: "qc2", cycleTimeMs: constant(200) },
          { id: "sink", cycleTimeMs: constant(50) },
        ],
        edges: [
          { source: "src", target: "qc1" },
          { source: "src", target: "qc2" },
          { source: "qc1", target: "sink" },
          { source: "qc2", target: "sink" },
        ],
      },
    });
    const qc1Completed = result.perStationCompleted[1] ?? 0;
    const qc2Completed = result.perStationCompleted[2] ?? 0;
    expect(qc2Completed).toBeGreaterThan(qc1Completed);
  });

  it("perEdgeFlowed counts parts that traversed each edge in a diamond", () => {
    const result = runChain({
      interStationBufferCapacity: 10,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
      topology: {
        nodes: [
          { id: "src", cycleTimeMs: constant(50) },
          { id: "qc1", cycleTimeMs: constant(200) },
          { id: "qc2", cycleTimeMs: constant(200) },
          { id: "sink", cycleTimeMs: constant(50) },
        ],
        edges: [
          { source: "src", target: "qc1" },
          { source: "src", target: "qc2" },
          { source: "qc1", target: "sink" },
          { source: "qc2", target: "sink" },
        ],
      },
    });
    expect(result.perEdgeFlowed).toHaveLength(4);
    // Sum of source→QC* must be >= sum of QC*→sink (parts in-flight at QCs at
    // horizon stay in the input edges; the upper-bound is bounded by inter-station
    // buffer capacity (10) × 2 inputs + 2 in-cycle = ~22 in worst case).
    const fromSrc = (result.perEdgeFlowed[0] ?? 0) + (result.perEdgeFlowed[1] ?? 0);
    const toSink = (result.perEdgeFlowed[2] ?? 0) + (result.perEdgeFlowed[3] ?? 0);
    expect(fromSrc).toBeGreaterThanOrEqual(toSink);
    expect(fromSrc - toSink).toBeLessThan(30);
    // Both QC branches should have non-trivial flow
    expect(result.perEdgeFlowed[0]).toBeGreaterThan(0);
    expect(result.perEdgeFlowed[1]).toBeGreaterThan(0);
  });

  it("rejects a topology with multiple sinks", () => {
    expect(() =>
      runChain({
        interStationBufferCapacity: 10,
        horizonMs: 10_000,
        warmupMs: 0,
        prng: new SeededPrng(),
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(100) },
            { id: "b", cycleTimeMs: constant(100) },
            { id: "c", cycleTimeMs: constant(100) },
          ],
          edges: [
            { source: "a", target: "b" },
            { source: "a", target: "c" }, // b + c are both sinks
          ],
        },
      }),
    ).toThrow(/sink/);
  });
});

describe("runChain — timeseries sampler (VROL-612)", () => {
  it("sampler off → samples is empty array (zero-cost path)", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    expect(result.samples).toEqual([]);
  });

  it("sampler on → emits one sample per intervalMs up to horizonMs", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(2),
      sampler: { intervalMs: 1_000 },
    });
    // 10s horizon / 1s interval → ticks at 1000, 2000, ..., 10000 = 10 samples.
    expect(result.samples).toHaveLength(10);
    expect(result.samples[0]?.tMs).toBe(1_000);
    expect(result.samples[result.samples.length - 1]?.tMs).toBe(10_000);
    // Strictly monotone time axis.
    for (let i = 1; i < result.samples.length; i++) {
      expect(result.samples[i]?.tMs).toBeGreaterThan(result.samples[i - 1]?.tMs ?? -1);
    }
  });

  it("last sample matches end-of-run totals exactly", () => {
    const result = runChain({
      stationCycleTimes: [constant(40), constant(40), constant(40)],
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(3),
      sampler: { intervalMs: 500 },
    });
    const last = result.samples[result.samples.length - 1];
    expect(last).toBeDefined();
    expect(last?.lineCompleted).toBe(result.completed);
    expect(last?.perStationCompleted).toEqual([...result.perStationCompleted]);
  });

  it("samples before warmupMs are dropped from the published array", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 3_000,
      prng: new SeededPrng(4),
      sampler: { intervalMs: 1_000 },
    });
    // ticks at 3000, 4000, ..., 10000 → 8 samples (3000 included since tMs >= warmupMs).
    expect(result.samples).toHaveLength(8);
    expect(result.samples[0]?.tMs).toBe(3_000);
    // lineCompleted is monotone non-decreasing.
    for (let i = 1; i < result.samples.length; i++) {
      expect(result.samples[i]?.lineCompleted).toBeGreaterThanOrEqual(
        result.samples[i - 1]?.lineCompleted ?? 0,
      );
    }
  });

  it("perStationCompleted is monotone non-decreasing per station across samples", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(5),
      sampler: { intervalMs: 500 },
    });
    for (let s = 1; s < result.samples.length; s++) {
      const curr = result.samples[s]?.perStationCompleted ?? [];
      const prev = result.samples[s - 1]?.perStationCompleted ?? [];
      for (let stn = 0; stn < curr.length; stn++) {
        expect(curr[stn]).toBeGreaterThanOrEqual(prev[stn] ?? 0);
      }
    }
  });
});
