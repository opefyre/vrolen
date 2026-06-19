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

  it("recurring replenishment fires at every interval up to the horizon (VROL-642)", () => {
    // intervalMs=2000, startMs=0, horizonMs=10000 → fires at t=0, 2000, 4000,
    // 6000, 8000, 10000 (6 events). Pool starts at 0, grows by 5 each event,
    // but the source station is depleting it — so we just assert the event
    // counter and that throughput keeps moving instead of dying after start.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(123),
      materials: {
        initialInventory: [[BOTTLES, 0]],
        stationRecipes: [
          {
            stationIndex: 1,
            requirements: [{ materialId: BOTTLES, qtyPerPart: 1 }],
          },
        ],
        recurringReplenishments: [{ materialId: BOTTLES, amount: 5, intervalMs: 2000 }],
      },
    });
    expect(result.replenishmentsFired).toBe(6);
    expect(result.completed).toBeGreaterThan(0);
  });

  it("combines one-shot + recurring on the same materialId (VROL-642)", () => {
    // 1 one-shot (atMs=500) + 6 recurring (t=0, 2000, 4000, 6000, 8000, 10000)
    // → 7 events total. Both share the same pool.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
      materials: {
        initialInventory: [[BOTTLES, 0]],
        stationRecipes: [
          {
            stationIndex: 1,
            requirements: [{ materialId: BOTTLES, qtyPerPart: 1 }],
          },
        ],
        replenishments: [{ materialId: BOTTLES, amount: 10, atMs: 500 }],
        recurringReplenishments: [{ materialId: BOTTLES, amount: 5, intervalMs: 2000 }],
      },
    });
    expect(result.replenishmentsFired).toBe(7);
  });

  it("maxInventory clamps so the pool never exceeds the cap (VROL-642)", () => {
    // amount=100 per fire, maxInventory=10. After first event, pool = 10.
    // Subsequent events fire but each is clamped to 0 (no headroom) until
    // consumption frees space. Without consumption, the pool stays at 10.
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(9),
      materials: {
        initialInventory: [[BOTTLES, 0]],
        // No station consumes BOTTLES → no depletion. Pool can only grow,
        // and the cap prevents it from going over 10.
        stationRecipes: [],
        recurringReplenishments: [
          { materialId: BOTTLES, amount: 100, intervalMs: 1000, maxInventory: 10 },
        ],
      },
    });
    const finalBottles = new Map(result.materialFinal ?? []).get(BOTTLES) ?? 0;
    expect(finalBottles).toBe(10);
    // 11 events fired (t=0..10000 inclusive) — counter unaffected by clamping.
    expect(result.replenishmentsFired).toBe(11);
  });

  it("rejects invalid recurring config at init (VROL-642)", () => {
    const base = {
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(),
    };
    expect(() =>
      runChain({
        ...base,
        materials: {
          initialInventory: [[BOTTLES, 10]],
          stationRecipes: [],
          recurringReplenishments: [{ materialId: BOTTLES, amount: 5, intervalMs: 0 }],
        },
      }),
    ).toThrow(/intervalMs must be > 0/);
    expect(() =>
      runChain({
        ...base,
        materials: {
          initialInventory: [[BOTTLES, 10]],
          stationRecipes: [],
          recurringReplenishments: [{ materialId: BOTTLES, amount: -1, intervalMs: 1000 }],
        },
      }),
    ).toThrow(/amount must be >= 0/);
    expect(() =>
      runChain({
        ...base,
        materials: {
          initialInventory: [[BOTTLES, 10]],
          stationRecipes: [],
          recurringReplenishments: [
            { materialId: BOTTLES, amount: 5, intervalMs: 1000, startMs: -1 },
          ],
        },
      }),
    ).toThrow(/startMs must be >= 0/);
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
    // VROL-616 changed the denominator from workers × horizon to "effectively
    // available ms" — a worker fully utilized during their shift reports
    // utilization ≈ 1.0, not 0.2. The starvation invariant is now expressed
    // via the throughput surface: the bulk of completed parts land before 2s.
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
    expect(result.laborUtilization).toBeDefined();
    // Worker fully engaged during their 2s window → util close to 1.0.
    expect(result.laborUtilization!).toBeGreaterThan(0.7);
    // Throughput is capped by the shift — completed count is far below what
    // a 10s run with 100ms cycles would deliver if the worker were always on.
    expect(result.completed).toBeLessThan(40); // would be ~95 on a full shift
  });

  it("schedules break-end events that wake Starved stations (VROL-618)", () => {
    // 1 worker, shift [0, 60s], break [10s, 30s]. Pre-VROL-618: station goes
    // Starved at t≈10s when the worker requests are rejected and never wakes —
    // completed stays at whatever was produced in [0, 10s].
    // With VROL-618: at t=30s the break-end event fires, executor retries,
    // worker pool now allows assignment, station resumes. completed grows
    // through [30s, 60s] too.
    const withBreak = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xb517),
      workers: {
        workers: [
          {
            ...worker("w1", ["any"], 60_000),
            breaks: [{ startMs: 10_000, endMs: 30_000 }],
          },
        ],
        requireDefault: ["any"],
      },
    });
    // ~10s of cycles before the break + ~30s of cycles after → well above the
    // ~95 a 10s-only stretch would deliver.
    expect(withBreak.completed).toBeGreaterThan(200);
    // Sanity: still less than a no-break shift since 20s are lost to the break.
    expect(withBreak.completed).toBeLessThan(500);
  });

  it("multi-worker break-end events fire independently (VROL-618)", () => {
    // 2 stations both need "any"; 2 workers with non-overlapping breaks.
    // At any instant, at least one worker is on shift and off break — the
    // chain never fully stalls. Just asserting the multi-event path doesn't
    // crash or skip wake-ups for one worker.
    const result = runChain({
      stationCycleTimes: [constant(80), constant(80)],
      interStationBufferCapacity: 5,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xb518),
      workers: {
        workers: [
          {
            ...worker("w1", ["any"], 60_000),
            breaks: [{ startMs: 10_000, endMs: 20_000 }],
          },
          {
            ...worker("w2", ["any"], 60_000),
            breaks: [{ startMs: 30_000, endMs: 40_000 }],
          },
        ],
        requireDefault: ["any"],
      },
    });
    expect(result.completed).toBeGreaterThan(0);
    expect(result.laborUtilization).toBeDefined();
  });

  it("per-worker breaks shrink the labor-util denominator, not the numerator (VROL-616)", () => {
    // 60s run, 1 worker on shift for the full 60s with a break at [30s, 60s].
    // Worker is available + busy for the first 30s, then the break Starves
    // the station — busyMs ≈ 30s, denom = shift - break = 30s, util ≈ 1.0.
    // Pre-VROL-616 denom would have been 60s and util would be a misleading 0.5.
    const result = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 5,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(0xdecade),
      workers: {
        workers: [
          {
            ...worker("w1", ["any"], 60_000),
            breaks: [{ startMs: 30_000, endMs: 60_000 }],
          },
        ],
        requireDefault: ["any"],
      },
    });
    expect(result.laborUtilization).toBeDefined();
    // Available 30s of the shift, busy ~30s → util ~1.0 (NOT 0.5).
    expect(result.laborUtilization!).toBeGreaterThan(0.8);
    // Throughput is capped by the pre-break window — far short of a full 60s run.
    expect(result.completed).toBeLessThan(350); // would be ~590 if break absent
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

describe("runChain — rework loops (VROL-626)", () => {
  it("per-station defect rate produces scrap on a topology run", () => {
    // DAG-mode lets us set per-station defectRate. With 0.5 at the sink, ~half
    // of completed parts should scrap.
    const result = runChain({
      topology: {
        nodes: [
          { id: "a", cycleTimeMs: constant(50) },
          { id: "b", cycleTimeMs: constant(50), defectRate: 0.5 },
        ],
        edges: [{ source: "a", target: "b" }],
      },
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
    });
    expect(result.perStationScrapped[1]).toBeGreaterThan(5);
    expect(result.lineScrapRate).toBeGreaterThan(0.1);
  });

  it("rework router pushes defective parts back upstream + bumps perStationReworked", () => {
    const result = runChain({
      topology: {
        nodes: [
          { id: "a", cycleTimeMs: constant(50) },
          { id: "b", cycleTimeMs: constant(50), defectRate: 0.5, reworkTargetId: "a" },
        ],
        edges: [{ source: "a", target: "b" }],
      },
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(0xc0ffee),
    });
    expect(result.perStationReworked).toHaveLength(2);
    expect(result.perStationReworked[1]).toBeGreaterThan(0);
    expect(result.lineReworkRate).toBeGreaterThan(0);
    // Scrap rate should be much lower than the no-rework version above since
    // most defects get re-routed instead of dropped.
    expect(result.lineScrapRate).toBeLessThan(0.1);
  });

  it("MAX_REWORK_PASSES caps the loop — parts that re-defect 3 times scrap", () => {
    // 100% defectRate at the rework target's child guarantees every part
    // that completes B is defective, and B reworks back to A. After 3
    // rework passes the same part scraps. Net: scrapped > 0 even with
    // rework configured.
    const result = runChain({
      topology: {
        nodes: [
          { id: "a", cycleTimeMs: constant(50) },
          { id: "b", cycleTimeMs: constant(50), defectRate: 1.0, reworkTargetId: "a" },
        ],
        edges: [{ source: "a", target: "b" }],
      },
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
    });
    expect(result.perStationScrapped[1]).toBeGreaterThan(0);
    expect(result.perStationReworked[1]).toBeGreaterThan(0);
    // Each scrapped part has been reworked exactly MAX_REWORK_PASSES (3) times
    // — so reworked count should be ~3x the scrap count for the run.
    expect(result.perStationReworked[1]).toBeGreaterThanOrEqual(
      (result.perStationScrapped[1] ?? 0) * 2,
    );
  });

  it("rejects an unknown reworkTargetId at run init", () => {
    expect(() =>
      runChain({
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(50) },
            { id: "b", cycleTimeMs: constant(50), reworkTargetId: "ghost" },
          ],
          edges: [{ source: "a", target: "b" }],
        },
        interStationBufferCapacity: 5,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/reworkTargetId .*ghost.* is not a known node/);
  });

  it("rejects a self-targeting rework station", () => {
    expect(() =>
      runChain({
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(50) },
            { id: "b", cycleTimeMs: constant(50), reworkTargetId: "b" },
          ],
          edges: [{ source: "a", target: "b" }],
        },
        interStationBufferCapacity: 5,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/cannot rework to itself/);
  });

  it("rework target with MULTIPLE incoming edges routes into one of the constituent buffers (regression for the default-canvas crash)", () => {
    // Diamond fan-in: a + b → c. c has 2 incoming edges so upstreamFor(c)
    // returns a MultiInputBuffer wrapper whose push() throws by design.
    // The rework router must NOT go through that wrapper — it has to pick a
    // concrete constituent edge buffer (this is what pushReworkTo does).
    // d defects and reworks to c. Before the fix this throws at runtime.
    const result = runChain({
      topology: {
        nodes: [
          { id: "src", cycleTimeMs: constant(30) },
          { id: "a", cycleTimeMs: constant(80) },
          { id: "b", cycleTimeMs: constant(80) },
          { id: "c", cycleTimeMs: constant(100) },
          { id: "d", cycleTimeMs: constant(50), defectRate: 0.5, reworkTargetId: "c" },
        ],
        edges: [
          { source: "src", target: "a" },
          { source: "src", target: "b" },
          { source: "a", target: "c" },
          { source: "b", target: "c" },
          { source: "c", target: "d" },
        ],
      },
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(0xdeed),
    });
    // The run completes without throwing AND defective parts at d get routed
    // back into c — perStationReworked at d (index 4) should be > 0.
    expect(result.perStationReworked[4]).toBeGreaterThan(0);
    expect(result.completed).toBeGreaterThan(0);
  });

  it("per-station reworkPassLimit overrides the default cap (VROL-638)", () => {
    // Same shape as the MAX_REWORK_PASSES cap test but with a per-station
    // limit of 1 — every defect gets ONE rework attempt then scraps. So
    // perStationReworked should be roughly equal to perStationScrapped
    // (not 2-3x as in the default-cap-of-3 case).
    const result = runChain({
      topology: {
        nodes: [
          { id: "a", cycleTimeMs: constant(50) },
          {
            id: "b",
            cycleTimeMs: constant(50),
            defectRate: 1.0,
            reworkTargetId: "a",
            reworkPassLimit: 1,
          },
        ],
        edges: [{ source: "a", target: "b" }],
      },
      interStationBufferCapacity: 10,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
    });
    const scrapped = result.perStationScrapped[1] ?? 0;
    const reworked = result.perStationReworked[1] ?? 0;
    expect(scrapped).toBeGreaterThan(0);
    expect(reworked).toBeGreaterThan(0);
    // With the cap at 1, each scrapped part is reworked exactly once before
    // scrapping → reworked / scrapped ≈ 1. The default cap of 3 gives ≈ 3
    // (see the test above). Assert ratio < 1.5 so we'd catch any regression
    // back to the global constant.
    expect(reworked / scrapped).toBeLessThan(1.5);
  });

  it("rejects a non-integer or zero reworkPassLimit at build (VROL-638)", () => {
    expect(() =>
      runChain({
        topology: {
          nodes: [
            { id: "a", cycleTimeMs: constant(50) },
            {
              id: "b",
              cycleTimeMs: constant(50),
              reworkTargetId: "a",
              reworkPassLimit: 0,
            },
          ],
          edges: [{ source: "a", target: "b" }],
        },
        interStationBufferCapacity: 5,
        horizonMs: 1_000,
        warmupMs: 0,
        prng: new SeededPrng(1),
      }),
    ).toThrow(/reworkPassLimit must be a positive integer/);
  });

  it("perStationReworked is always present and zero when no rework configured", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 1_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    expect(result.perStationReworked).toEqual([0, 0]);
    expect(result.lineReworkRate).toBe(0);
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

  it("perEdgeBufferFill is populated and aligned with perEdgeFlowed (VROL-615)", () => {
    const result = runChain({
      stationCycleTimes: [constant(20), constant(50), constant(20)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(6),
      sampler: { intervalMs: 500 },
    });
    expect(result.samples.length).toBeGreaterThan(0);
    // Two edges in a 3-station linear chain.
    expect(result.perEdgeFlowed).toHaveLength(2);
    for (const s of result.samples) {
      expect(s.perEdgeBufferFill).toHaveLength(2);
      // Values are integers in [0, capacity].
      for (const fill of s.perEdgeBufferFill) {
        expect(Number.isInteger(fill)).toBe(true);
        expect(fill).toBeGreaterThanOrEqual(0);
        expect(fill).toBeLessThanOrEqual(5);
      }
    }
    // The slow middle station should make buffer 0 (upstream of it) build up.
    const fillsAtBuffer0 = result.samples.map((s) => s.perEdgeBufferFill[0] ?? 0);
    expect(Math.max(...fillsAtBuffer0)).toBeGreaterThan(0);
  });

  it("perEdgeBufferFill is empty when topology has no inter-station edges (VROL-615)", () => {
    const result = runChain({
      stationCycleTimes: [constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 2_000,
      warmupMs: 0,
      prng: new SeededPrng(7),
      sampler: { intervalMs: 500 },
    });
    expect(result.samples.length).toBeGreaterThan(0);
    for (const s of result.samples) {
      expect(s.perEdgeBufferFill).toEqual([]);
    }
  });

  it("perStationStateMs is populated and aligns with perStationCompleted (VROL-619)", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(11),
      sampler: { intervalMs: 1_000 },
    });
    expect(result.samples.length).toBeGreaterThan(0);
    for (const s of result.samples) {
      expect(s.perStationStateMs).toHaveLength(s.perStationCompleted.length);
      for (const stateMs of s.perStationStateMs) {
        // Every record key is a state name → ms.
        for (const v of Object.values(stateMs)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("per-station state-time sums to ~tMs at each sample (VROL-619)", () => {
    const result = runChain({
      stationCycleTimes: [constant(80), constant(80)],
      interStationBufferCapacity: 5,
      horizonMs: 4_000,
      warmupMs: 0,
      prng: new SeededPrng(12),
      sampler: { intervalMs: 1_000 },
    });
    for (const s of result.samples) {
      for (const stateMs of s.perStationStateMs) {
        const sum = Object.values(stateMs).reduce((a, b) => a + b, 0);
        // Tracker covers every ms — the per-station total should match tMs
        // within a small tolerance for transition-time rounding.
        expect(sum).toBeGreaterThanOrEqual(s.tMs - 5);
        expect(sum).toBeLessThanOrEqual(s.tMs + 5);
      }
    }
  });

  it("per-state cumulative time is monotone non-decreasing across samples (VROL-619)", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(50), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(13),
      sampler: { intervalMs: 500 },
    });
    for (let i = 1; i < result.samples.length; i++) {
      const prev = result.samples[i - 1]?.perStationStateMs ?? [];
      const curr = result.samples[i]?.perStationStateMs ?? [];
      for (let stn = 0; stn < curr.length; stn++) {
        const prevRow = prev[stn] ?? {};
        const currRow = curr[stn] ?? {};
        for (const [state, ms] of Object.entries(currRow)) {
          const before = prevRow[state] ?? 0;
          expect(ms).toBeGreaterThanOrEqual(before);
        }
      }
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

  it("perStationRework: last sample matches result + monotone per station (VROL-639)", () => {
    // DAG with a rework loop so the counters actually move.
    const result = runChain({
      topology: {
        nodes: [
          { id: "a", cycleTimeMs: constant(50) },
          { id: "b", cycleTimeMs: constant(50), defectRate: 0.4, reworkTargetId: "a" },
        ],
        edges: [{ source: "a", target: "b" }],
      },
      interStationBufferCapacity: 5,
      horizonMs: 3_000,
      warmupMs: 0,
      prng: new SeededPrng(31),
      sampler: { intervalMs: 250 },
    });
    expect(result.samples.length).toBeGreaterThan(0);
    const last = result.samples[result.samples.length - 1]!;
    // Width matches perStationCompleted at every sample.
    for (const s of result.samples) {
      expect(s.perStationRework.length).toBe(s.perStationCompleted.length);
    }
    // Last sample's rework totals match the run-final rework totals.
    expect([...last.perStationRework]).toEqual([...result.perStationReworked]);
    // Monotone non-decreasing per station.
    for (let i = 1; i < result.samples.length; i++) {
      const curr = result.samples[i]!.perStationRework;
      const prev = result.samples[i - 1]!.perStationRework;
      for (let stn = 0; stn < curr.length; stn++) {
        expect(curr[stn]).toBeGreaterThanOrEqual(prev[stn] ?? 0);
      }
    }
    // Station 1 (the rework source) actually moved.
    expect(last.perStationRework[1]).toBeGreaterThan(0);
  });
});
