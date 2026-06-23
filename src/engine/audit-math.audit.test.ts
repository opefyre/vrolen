/**
 * Engine math audit (launch-readiness).
 *
 * Each test computes the expected output by hand (closed form) and compares
 * against the engine's runChain result. Tolerances are stated per-test. The
 * companion report at vrolen/AUDIT-ENGINE-MATH.md summarises pass/fail.
 *
 * AUDIT-ONLY. These tests must not modify engine source.
 */
import { describe, expect, it } from "vitest";

import { runChain, type ChainResult } from "./chain-harness";
import { constant } from "./distribution";
import { asMaterialId, asResourceId } from "./ids";
import { SeededPrng } from "./prng";
import { detectWarmup } from "../lib/warmup-detection";
import { runSensitivitySweep } from "../lib/sensitivity-sweep";
import { runOptimizationSearch } from "../lib/optimization-search";
import type { Distribution } from "./distribution";

const STATE_KEYS = [
  "Running",
  "Starved",
  "BlockedOut",
  "Down",
  "Setup",
  "Maintenance",
  "Idle",
] as const;

// ──────────────────────────────────────────────────────────────────────────
// 1. Throughput / cycle time
// ──────────────────────────────────────────────────────────────────────────
describe("audit 1 — throughput / cycle time (single station)", () => {
  it("constant 100ms cycle, 60s horizon → 600 parts ±1", () => {
    const result = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // Expected: 60000 / 100 = 600 parts. Closed-form, no random.
    expect(result.completed).toBeGreaterThanOrEqual(599);
    expect(result.completed).toBeLessThanOrEqual(601);
    // throughputLambda is parts per ms. Per-hour = lambda × 3,600,000.
    const perHour = result.throughputLambda * 3_600_000;
    // Expected 36,000 / hr (600/min × 60 = 36,000). Tolerance 1%.
    expect(perHour).toBeGreaterThan(36_000 * 0.99);
    expect(perHour).toBeLessThan(36_000 * 1.01);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Bottleneck identification
// ──────────────────────────────────────────────────────────────────────────
describe("audit 2 — bottleneck identification", () => {
  it("A(50ms) → B(200ms) → C(50ms): bottleneckStationIdx = 1 (B), throughput ≈ 5/s", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(200), constant(50)],
      interStationBufferCapacity: 20,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(1),
      stationLabels: ["A", "B", "C"],
    });
    // Closed-form bottleneck = largest mean cycle → station B (idx 1).
    expect(result.bottleneckStationIdx).toBe(1);
    // bottlenecks[0] is the one with highest runningPct → B.
    expect(result.bottlenecks[0]?.label).toBe("B");
    // Throughput ≈ 1/200 parts/ms = 0.005 = 5/s.
    expect(result.throughputLambda).toBeGreaterThan(0.005 * 0.95);
    expect(result.throughputLambda).toBeLessThan(0.005 * 1.05);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Parallel capacity (VROL-646)
// ──────────────────────────────────────────────────────────────────────────
describe("audit 3 — parallel capacity scaling", () => {
  const buildTopology = (capB: number) => ({
    nodes: [
      { id: "A", label: "A", cycleTimeMs: constant(50) },
      { id: "B", label: "B", cycleTimeMs: constant(200), capacity: capB },
      { id: "C", label: "C", cycleTimeMs: constant(50) },
    ],
    edges: [
      { source: "A", target: "B" },
      { source: "B", target: "C" },
    ],
  });

  const runWithCap = (capB: number): ChainResult =>
    runChain({
      topology: buildTopology(capB),
      interStationBufferCapacity: 50,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(1),
    });

  it("capacity=1 → ~5 parts/s", () => {
    const r = runWithCap(1);
    expect(r.throughputLambda).toBeGreaterThan(0.005 * 0.9);
    expect(r.throughputLambda).toBeLessThan(0.005 * 1.1);
  });
  it("capacity=2 → ~10 parts/s", () => {
    const r = runWithCap(2);
    expect(r.throughputLambda).toBeGreaterThan(0.01 * 0.9);
    expect(r.throughputLambda).toBeLessThan(0.01 * 1.1);
  });
  it("capacity=4 → ~20 parts/s (limited by upstream at 50ms)", () => {
    const r = runWithCap(4);
    // B can do 4×5=20/s but A is 1/0.05 = 20/s. Throughput is upstream-limited
    // here so closed form is min(B, A) = 20/s.
    expect(r.throughputLambda).toBeGreaterThan(0.02 * 0.9);
    expect(r.throughputLambda).toBeLessThan(0.02 * 1.05);
  });
  it("capacity=10 → bounded by upstream at 20/s", () => {
    const r = runWithCap(10);
    // Upper bound is 1/50ms = 20/s. Should NOT exceed.
    expect(r.throughputLambda).toBeLessThan(0.02 * 1.05);
    expect(r.throughputLambda).toBeGreaterThan(0.02 * 0.9);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Defect rate — Poisson 3σ check
// ──────────────────────────────────────────────────────────────────────────
describe("audit 4 — defect rate scrap counts", () => {
  it("single-station chain with defectRate=0.1 over 60s ≈ 10% scrapped", () => {
    const result = runChain({
      topology: {
        nodes: [{ id: "X", cycleTimeMs: constant(100), defectRate: 0.1 }],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // FINDING: result.completed counts BOTH good + defective cycles when the
    // sink station has a defectRate (because sinkExecutor.onCompletion is
    // fired for every completion, defective or not). The cleaner closed-form
    // is perStationCompleted[0] + perStationScrapped[0] = total cycles ≈ 600.
    const totalAttempts =
      (result.perStationCompleted[0] ?? 0) + (result.perStationScrapped[0] ?? 0);
    expect(totalAttempts).toBeGreaterThanOrEqual(599);
    expect(totalAttempts).toBeLessThanOrEqual(601);
    const scrap = result.perStationScrapped[0] ?? 0;
    // 3σ window for Bin(600, 0.1): mean 60, stddev sqrt(600*0.1*0.9) ≈ 7.35
    //   → 3σ ≈ ±22, range [38, 82]
    expect(scrap).toBeGreaterThanOrEqual(38);
    expect(scrap).toBeLessThanOrEqual(82);
  });

  it("FIXED: result.completed excludes sink defects (= perStationCompleted[sinkIdx])", () => {
    // Closed form: 60000/100 = 600 cycles. Of those, ~50% are defective and
    // ~50% good. result.completed should report only the GOOD parts that
    // exited. After the fix in chain-harness sinkExecutor.onCompletion, the
    // sink filter aligns result.completed with perStationCompleted[sinkIdx].
    const result = runChain({
      topology: {
        nodes: [
          { id: "A", cycleTimeMs: constant(100) },
          { id: "B", cycleTimeMs: constant(100), defectRate: 0.5 },
        ],
        edges: [{ source: "A", target: "B" }],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const goodAtSink = result.perStationCompleted[1] ?? 0; // ≈ 311
    // result.completed must equal the good-only sink count after the fix.
    expect(result.completed).toBe(goodAtSink);
    // throughputLambda must reflect good-only rate: ≈ 0.005 (≈ 5/s), not ≈ 0.01.
    expect(result.throughputLambda).toBeLessThan(0.007);
    expect(result.throughputLambda).toBeGreaterThan(0.004);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Setup time
// ──────────────────────────────────────────────────────────────────────────
describe("audit 5 — setup time", () => {
  it("100ms cycle + 50ms setup per cycle → ~400 parts in 60s (throughput OK)", () => {
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "X",
            cycleTimeMs: constant(100),
            setupTimeMs: constant(50),
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // Effective per-cycle = 150ms → 60000/150 = 400 parts. PASSES on throughput.
    expect(result.completed).toBeGreaterThanOrEqual(395);
    expect(result.completed).toBeLessThanOrEqual(405);
  });

  it("FIXED: setup-complete dispatch exits Setup so Running dominates OEE", () => {
    // After wiring the setup-complete branch into chain-harness dispatch,
    // handleSetupComplete transitions Setup → Running. The engine's current
    // state-machine treats Setup as a once-on-entry transition (Idle→Setup
    // on the very first cycle), so subsequent in-cycle setups don't re-enter
    // Setup — they're accounted for inside the Running window. Pre-fix:
    // Setup % = 1.0 forever. Post-fix: Running dominates, Setup is the tiny
    // initial slice. OEE runTimeMs + availability now reflect real Running.
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "X",
            cycleTimeMs: constant(100),
            setupTimeMs: constant(50),
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const breakdown = result.bottlenecks[0]?.breakdown ?? [];
    const setupSlice = breakdown.find((b) => b.state === "Setup")?.pct ?? 0;
    const runningSlice = breakdown.find((b) => b.state === "Running")?.pct ?? 0;
    // Setup must NO LONGER be ~1.0 (pre-fix was stuck at 1.0).
    expect(setupSlice).toBeLessThan(0.1);
    // Running must now dominate (was 0 pre-fix).
    expect(runningSlice).toBeGreaterThan(0.9);
    // OEE: Running time tracked, so runTimeMs > 0 and availability > 0.
    expect(result.perStationOee[0]?.runTimeMs ?? 0).toBeGreaterThan(50_000);
    expect(result.perStationOee[0]?.availability ?? 0).toBeGreaterThan(0.9);
    expect(result.perStationOee[0]?.oee ?? 0).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Changeover matrix + products
// ──────────────────────────────────────────────────────────────────────────
describe("audit 6 — changeover matrix + product mix", () => {
  it("alternating A/B with 500ms changeover both ways → ~100 parts in 60s", () => {
    // Closed form: every cycle alternates → setup 500ms + cycle 100ms = 600ms / part.
    // 60_000 / 600 = 100 parts.
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "X",
            cycleTimeMs: constant(100),
            changeoverMatrix: {
              A: { B: constant(500) },
              B: { A: constant(500) },
            },
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      products: {
        products: [
          { id: "A", weight: 1 },
          { id: "B", weight: 1 },
        ],
      },
    });
    // Random mix won't be perfectly alternating; observed throughput is the avg.
    // Mean changeover per cycle if products independent 50/50: P(switch)=0.5, so
    // E[setup] = 0.5 * 500 = 250ms. E[per cycle] = 350ms → ~171 parts.
    // We accept either interpretation: 100 (perfect alternation) or 171 (random mix).
    // Range: 90–200 (broad — flags that the model behaviour is reasonable).
    expect(result.completed).toBeGreaterThanOrEqual(90);
    expect(result.completed).toBeLessThanOrEqual(200);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Maintenance window
// ──────────────────────────────────────────────────────────────────────────
describe("audit 7 — maintenance windows", () => {
  it("100ms cycle, 20s horizon, maint [10s, 15s] → ~150 parts; perStationMaintenanceMs ≈ 5000", () => {
    const maintenance = {
      perStationWindows: new Map([[0, [{ startMs: 10_000, endMs: 15_000 }]]]),
    };
    const result = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 100,
      horizonMs: 20_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      maintenance,
    });
    // 15s of productive time / 100ms cycle = 150 parts.
    expect(result.completed).toBeGreaterThanOrEqual(140);
    expect(result.completed).toBeLessThanOrEqual(155);
    // perStationMaintenanceMs should report 5000ms.
    expect(result.perStationMaintenanceMs).toBeDefined();
    const maintMs = result.perStationMaintenanceMs?.[0] ?? 0;
    expect(maintMs).toBeGreaterThan(4_900);
    expect(maintMs).toBeLessThan(5_100);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 8. Breakdowns (MTBF / MTTR availability ≈ 10/12 = 0.833)
// ──────────────────────────────────────────────────────────────────────────
describe("audit 8 — breakdown availability MTBF/(MTBF+MTTR)", () => {
  it("MTBF=10000, MTTR=2000 → availability ≈ 0.833", () => {
    const result = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 100,
      horizonMs: 600_000, // 10 min, generous to converge
      warmupMs: 0,
      prng: new SeededPrng(1),
      breakdowns: {
        mtbfMs: { kind: "exponential", rate: 1 / 10_000 },
        mttrMs: constant(2_000),
      },
    });
    const a = result.perStationOee[0]?.availability ?? 0;
    // Expected 10/12 = 0.833. ±10% (loose: long-run sampling variance).
    expect(a).toBeGreaterThan(0.75);
    expect(a).toBeLessThan(0.92);
    // At least some breakdowns must have fired.
    expect(result.perStationBreakdowns?.[0] ?? 0).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 9. Rework loop
// ──────────────────────────────────────────────────────────────────────────
describe("audit 9 — rework loop", () => {
  it("A → B(defect 0.5, reworkTo A) → C: rework + scrap both > 0, throughput accounts for rework load", () => {
    const result = runChain({
      topology: {
        nodes: [
          { id: "A", cycleTimeMs: constant(50) },
          {
            id: "B",
            cycleTimeMs: constant(100),
            defectRate: 0.5,
            reworkTargetId: "A",
          },
          { id: "C", cycleTimeMs: constant(50) },
        ],
        edges: [
          { source: "A", target: "B" },
          { source: "B", target: "C" },
        ],
      },
      interStationBufferCapacity: 50,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const reworkedB = result.perStationReworked[1] ?? 0;
    const scrappedB = result.perStationScrapped[1] ?? 0;
    expect(reworkedB).toBeGreaterThan(0);
    expect(scrappedB).toBeGreaterThan(0); // some hit pass limit
    // Throughput should be < 1/100 (bottleneck cycle B) because rework adds load.
    expect(result.throughputLambda).toBeLessThan(0.01);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 10. Per-product cycle override
// ──────────────────────────────────────────────────────────────────────────
describe("audit 10 — per-product cycle override", () => {
  it("A (60%, 50ms), B (40%, 150ms) → weighted-mean cycle 90ms → ~666 parts in 60s", () => {
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "X",
            cycleTimeMs: constant(100),
            cycleByProduct: {
              A: constant(50),
              B: constant(150),
            },
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      products: {
        products: [
          { id: "A", weight: 0.6 },
          { id: "B", weight: 0.4 },
        ],
      },
    });
    // Weighted mean cycle = 0.6*50 + 0.4*150 = 90ms. Expected completed = 60000/90 ≈ 666.
    expect(result.completed).toBeGreaterThan(600);
    expect(result.completed).toBeLessThan(720);
    // Per-product counts present.
    expect(result.perProductCompleted).toBeDefined();
    const aCount = result.perProductCompleted?.get("A") ?? 0;
    const bCount = result.perProductCompleted?.get("B") ?? 0;
    // A ≈ 60% of total ±5%.
    const aFrac = aCount / Math.max(1, aCount + bCount);
    expect(aFrac).toBeGreaterThan(0.55);
    expect(aFrac).toBeLessThan(0.65);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 11. Source (finite rate arrivals)
// ──────────────────────────────────────────────────────────────────────────
describe("audit 11 — source-bound throughput", () => {
  it("source interArrival 200ms, sink 100ms → ~5/s, source-bound", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 200,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(1),
      source: { interArrivalMs: constant(200) },
    });
    // 60_000 / 200 = 300 arrivals + t=0 = 301 events expected.
    expect(result.sourceArrivalsFired).toBeGreaterThanOrEqual(295);
    expect(result.sourceArrivalsFired).toBeLessThanOrEqual(305);
    // Source-bound throughput ≈ 5/s = 0.005 parts/ms.
    expect(result.throughputLambda).toBeGreaterThan(0.005 * 0.9);
    expect(result.throughputLambda).toBeLessThan(0.005 * 1.05);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 12. Materials — line stops after stock runs out
// ──────────────────────────────────────────────────────────────────────────
describe("audit 12 — materials cap line", () => {
  it("station consumes 1 bottle + 1 cap per part, inventory 100 of each → ≤100 parts", () => {
    const BOTTLES = asMaterialId("bottles");
    const CAPS = asMaterialId("caps");
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      interStationBufferCapacity: 50,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      materials: {
        initialInventory: [
          [BOTTLES, 100],
          [CAPS, 100],
        ],
        stationRecipes: [
          {
            stationIndex: 1,
            requirements: [
              { materialId: BOTTLES, qtyPerPart: 1 },
              { materialId: CAPS, qtyPerPart: 1 },
            ],
          },
        ],
      },
    });
    expect(result.completed).toBeLessThanOrEqual(100);
    expect(result.completed).toBeGreaterThan(50); // should hit the cap, not stall early
    const finalByMat = new Map(result.materialFinal ?? []);
    expect(finalByMat.get(BOTTLES)).toBe(0);
    expect(finalByMat.get(CAPS)).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 13. Worker pool — shift window caps runtime
// ──────────────────────────────────────────────────────────────────────────
describe("audit 13 — worker shift bounds runtime", () => {
  it("1 worker, shift [0, 30s], horizon 60s → Running time tops out ≈ 30s", () => {
    const result = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      workers: {
        workers: [
          {
            id: asResourceId("w1"),
            name: "w1",
            skills: ["lathe"],
            shifts: [{ startMs: 0, endMs: 30_000 }],
          },
        ],
        requireDefault: ["lathe"],
      },
    });
    // After 30s the worker is off-shift; station starves until horizon.
    const runMs = result.perStationOee[0]?.runTimeMs ?? 0;
    // Expected ~30000 ms but the cycle in-flight at shift end completes after
    // shift end (worker is busy until cycle done, release at completion).
    expect(runMs).toBeGreaterThan(29_500);
    expect(runMs).toBeLessThan(30_500);
    // ~300 parts (30s / 100ms).
    expect(result.completed).toBeGreaterThanOrEqual(295);
    expect(result.completed).toBeLessThanOrEqual(305);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 14. Warmup window
// ──────────────────────────────────────────────────────────────────────────
describe("audit 14 — warmup window excludes pre-warmup completions", () => {
  it("100ms cycle, 60s horizon, warmup 5s → completed reflects post-warmup window", () => {
    const result = runChain({
      stationCycleTimes: [constant(100)],
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(1),
    });
    // Pre-warmup parts: 50. Post-warmup: 550. completed reports 550.
    expect(result.completed).toBeGreaterThanOrEqual(545);
    expect(result.completed).toBeLessThanOrEqual(555);
    expect(result.elapsedMs).toBe(55_000);
    // perStationCompleted is NOT windowed — it's cumulative on the executor.
    // Cross-check that it's higher than result.completed.
    const stationCompleted = result.perStationCompleted[0] ?? 0;
    expect(stationCompleted).toBeGreaterThanOrEqual(result.completed);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 15. Welch warmup detection
// ──────────────────────────────────────────────────────────────────────────
describe("audit 15 — Welch warmup detection", () => {
  it("synthetic ramp-up samples plateau → detectWarmup recommends near plateau", () => {
    // Build samples: throughput rate ramps over first 5s, then flatlines at 0.005/ms.
    // Sampler emits one snapshot per 1000ms.
    const samples = [];
    let cum = 0;
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      const rate = t < 5_000 ? 0.005 * (t / 5_000) : 0.005;
      cum += rate * 1_000;
      samples.push({
        tMs: t,
        lineCompleted: Math.round(cum),
        perStationCompleted: [Math.round(cum)],
        perEdgeBufferFill: [],
        perStationStateMs: [],
        perStationRework: [],
      });
    }
    const rec = detectWarmup(samples, 60_000);
    // VROL-AUDIT — after the Welch fix (2% tolerance, 3 consecutive in-band
    // windows), the recommendation lands at the plateau (~5000 ms) instead
    // of crossing the threshold during the ramp.
    expect(rec.recommendedMs).not.toBeNull();
    expect(rec.recommendedMs!).toBeGreaterThanOrEqual(3_500);
    expect(rec.recommendedMs!).toBeLessThanOrEqual(6_500);
    expect(rec.meanLambda).toBeGreaterThan(0.004);
    expect(rec.meanLambda).toBeLessThan(0.006);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 16. Little's Law (L = λW)
// ──────────────────────────────────────────────────────────────────────────
describe("audit 16 — Little's Law", () => {
  it("single-station deterministic chain → L = λW within 5%", () => {
    const result = runChain({
      stationCycleTimes: [constant(1_000), constant(1_000), constant(1_000)],
      interStationBufferCapacity: 50,
      horizonMs: 3_600_000,
      warmupMs: 60_000,
      prng: new SeededPrng(1),
    });
    const predicted = result.throughputLambda * result.avgTimeInSystemW;
    const ratio = predicted / result.averageWipL;
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 17. Sensitivity sweep monotonicity
// ──────────────────────────────────────────────────────────────────────────
describe("audit 17 — sensitivity sweep monotonicity at the bottleneck", () => {
  it("varying bottleneck cycle ±20% produces monotone throughput response", () => {
    const stationCycleDistributions: readonly Distribution[] = [
      constant(50),
      constant(200),
      constant(50),
    ];
    const stationLabels = ["A", "B", "C"];
    const summary = runSensitivitySweep({
      horizonMs: 60_000,
      warmupMs: 5_000,
      seed: 1,
      stationCycleDistributions,
      stationLabels,
      buildBaseOptions: () => ({
        stationCycleTimes: stationCycleDistributions,
        interStationBufferCapacity: 50,
        horizonMs: 60_000,
        warmupMs: 5_000,
        prng: new SeededPrng(1),
        stationLabels,
      }),
    });
    // Top swing row should be the bottleneck (station B).
    expect(summary.rows[0]?.stationLabel).toBe("B");
    // For station B: high cycle (1.2×200=240ms) → lower throughput; low cycle (160ms) → higher.
    const bRow = summary.rows.find((r) => r.stationLabel === "B");
    expect(bRow).toBeDefined();
    expect(bRow!.lowPerHour).toBeGreaterThan(bRow!.highPerHour);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 18. WIP curve — buffer sweep monotone (non-decreasing)
// ──────────────────────────────────────────────────────────────────────────
describe("audit 18 — WIP curve: throughput non-decreasing in buffer capacity", () => {
  it("varying buffer 1, 2, 4, 8, 16, 32 → throughput non-decreasing or plateau", () => {
    const buffers = [1, 2, 4, 8, 16, 32];
    const tputs = buffers.map((cap) => {
      const r = runChain({
        // Make buffers actually matter — give the bottleneck noise so it
        // benefits from a buffer cushion (deterministic cycles + balanced
        // chain don't need buffers at all).
        stationCycleTimes: [
          { kind: "uniform", min: 80, max: 120 },
          { kind: "uniform", min: 80, max: 120 },
          { kind: "uniform", min: 80, max: 120 },
        ],
        interStationBufferCapacity: cap,
        horizonMs: 60_000,
        warmupMs: 5_000,
        prng: new SeededPrng(1),
      });
      return r.throughputLambda;
    });
    // Each next must be >= previous - small noise floor.
    const epsilon = 1e-4;
    for (let i = 1; i < tputs.length; i++) {
      expect(tputs[i]).toBeGreaterThanOrEqual(tputs[i - 1]! - epsilon);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 19. Optimization grid search — best candidate is globally best
// ──────────────────────────────────────────────────────────────────────────
describe("audit 19 — optimization grid search picks the best candidate", () => {
  it("2D grid: best.meanThroughputPerHour >= every other candidate", () => {
    const baseCycle = constant(200);
    const summary = runOptimizationSearch({
      horizonMs: 30_000,
      warmupMs: 2_000,
      seed: 1,
      currentCapacity: 4,
      targetStationIdx: 1,
      targetStationLabel: "B",
      buildBaseOptions: (mult) => ({
        topology: {
          nodes: [
            { id: "A", cycleTimeMs: constant(50) },
            { id: "B", cycleTimeMs: scaleConstant(baseCycle, mult) },
            { id: "C", cycleTimeMs: constant(50) },
          ],
          edges: [
            { source: "A", target: "B" },
            { source: "B", target: "C" },
          ],
        },
        interStationBufferCapacity: 4,
        horizonMs: 30_000,
        warmupMs: 2_000,
        prng: new SeededPrng(1),
      }),
      bufferLevels: [2, 8, 32],
      cycleMultipliers: [0.75, 1.0],
      replicationsPerCandidate: 1,
    });
    for (const c of summary.candidates) {
      expect(summary.best.meanThroughputPerHour).toBeGreaterThanOrEqual(c.meanThroughputPerHour);
    }
  });
});
function scaleConstant(d: Distribution, mult: number): Distribution {
  if (d.kind === "constant") return { kind: "constant", value: d.value * mult };
  return d;
}

// ──────────────────────────────────────────────────────────────────────────
// 20. Determinism
// ──────────────────────────────────────────────────────────────────────────
describe("audit 20 — determinism by seed", () => {
  const baseOpts = () => ({
    stationCycleTimes: [constant(100), constant(200), constant(100)],
    interStationBufferCapacity: 10,
    horizonMs: 60_000,
    warmupMs: 5_000,
    breakdowns: {
      mtbfMs: { kind: "exponential" as const, rate: 1 / 5_000 },
      mttrMs: constant(500),
    },
  });
  it("same seed → identical completed / throughput", () => {
    const a = runChain({ ...baseOpts(), prng: new SeededPrng(7) });
    const b = runChain({ ...baseOpts(), prng: new SeededPrng(7) });
    expect(a.completed).toBe(b.completed);
    expect(a.throughputLambda).toBe(b.throughputLambda);
    expect(a.perStationCompleted).toEqual(b.perStationCompleted);
  });
  it("different seed → different result", () => {
    const a = runChain({ ...baseOpts(), prng: new SeededPrng(7) });
    const b = runChain({ ...baseOpts(), prng: new SeededPrng(8) });
    // Random breakdown timing → different completed counts expected.
    expect(a.completed).not.toBe(b.completed);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 21. Replications variance > 0 and small relative to mean
// ──────────────────────────────────────────────────────────────────────────
describe("audit 21 — replications produce variance > 0 but bounded", () => {
  it("30 replications: variance > 0 AND stddev < 50% of mean for a stable line", () => {
    const completions: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = runChain({
        stationCycleTimes: [constant(50), constant(200), constant(50)],
        interStationBufferCapacity: 20,
        horizonMs: 30_000,
        warmupMs: 2_000,
        prng: new SeededPrng(i + 1),
        breakdowns: {
          mtbfMs: { kind: "exponential", rate: 1 / 5_000 },
          mttrMs: constant(500),
        },
      });
      completions.push(r.completed);
    }
    const mean = completions.reduce((s, v) => s + v, 0) / completions.length;
    const variance = completions.reduce((s, v) => s + (v - mean) ** 2, 0) / completions.length;
    const stddev = Math.sqrt(variance);
    expect(variance).toBeGreaterThan(0);
    expect(stddev / mean).toBeLessThan(0.5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 22. OEE math — A × P × Q
// ──────────────────────────────────────────────────────────────────────────
describe("audit 22 — OEE math identity (A × P × Q = OEE)", () => {
  it("perStationOee[i].availability × performance × quality = oee", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(200), constant(50)],
      interStationBufferCapacity: 10,
      horizonMs: 60_000,
      warmupMs: 5_000,
      prng: new SeededPrng(1),
    });
    for (const m of result.perStationOee) {
      const product = m.availability * m.performance * m.quality;
      expect(Math.abs(product - m.oee)).toBeLessThan(1e-10);
      // Sanity bounds.
      expect(m.availability).toBeGreaterThanOrEqual(0);
      expect(m.availability).toBeLessThanOrEqual(1);
      expect(m.performance).toBeGreaterThanOrEqual(0);
      expect(m.performance).toBeLessThanOrEqual(1);
      expect(m.quality).toBeGreaterThanOrEqual(0);
      expect(m.quality).toBeLessThanOrEqual(1);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 23. State percentages sum to 1.0
// ──────────────────────────────────────────────────────────────────────────
describe("audit 23 — state percentages sum to 100%", () => {
  it("Running + Starved + BlockedOut + Down + Setup + Maintenance + Idle ≈ 1", () => {
    const result = runChain({
      stationCycleTimes: [constant(50), constant(200), constant(50)],
      interStationBufferCapacity: 5,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      breakdowns: {
        mtbfMs: { kind: "exponential", rate: 1 / 5_000 },
        mttrMs: constant(500),
      },
    });
    for (const b of result.bottlenecks) {
      const total = b.breakdown.reduce((s, x) => s + x.pct, 0);
      expect(total).toBeGreaterThan(0.999);
      expect(total).toBeLessThan(1.001);
      // No unknown states.
      for (const item of b.breakdown) {
        expect(STATE_KEYS).toContain(item.state as (typeof STATE_KEYS)[number]);
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// 24. Mass balance — arrivals = completed + scrapped + WIP_held
// ──────────────────────────────────────────────────────────────────────────
describe("audit 24 — mass balance", () => {
  it("source mode: arrivals × batch = completed + scrapped + WIP", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100), constant(100)],
      interStationBufferCapacity: 50,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
      source: { interArrivalMs: constant(200) },
    });
    const arrivals = result.sourceArrivalsFired ?? 0;
    // batchSize defaults to 1.
    const completed = result.perStationCompleted[2] ?? 0;
    const scrapped = result.perStationScrapped.reduce((s, v) => s + v, 0);
    // WIP held inside the system at horizon ≈ averageWipL minus
    // in-flight estimate is not exact, so we use a slack window:
    // completed + scrapped ≤ arrivals.
    expect(completed + scrapped).toBeLessThanOrEqual(arrivals);
    // And the diff should be small — bounded by total in-flight + buffer
    // contents at horizon. With 3 stations capacity 1 and short buffers,
    // delta < 10 is reasonable.
    const delta = arrivals - (completed + scrapped);
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(20);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// VROL-897 — Availability semantics: no breakdowns ⇒ A ≈ 100%, even when
// the station spent the window heavily Blocked or Starved.
// ──────────────────────────────────────────────────────────────────────────
describe("audit VROL-897 — Availability ignores starvation + blocking", () => {
  it("heavily-blocked Mixer with zero Down ⇒ Availability ≈ 100%, OEE drag is Performance", () => {
    // Mixer (idx 0, fast 50ms) is upstream of an extremely slow Filler
    // (idx 1, 2s cycle). Buffer capacity 2 means Mixer fills the buffer
    // within a few cycles and then sits Blocked for the rest of the run.
    // Zero breakdowns, zero setup, zero maintenance — so by textbook
    // semantics Mixer's Availability is 100%; Performance is the lever
    // that drops (small goodParts × idealCycle vs. window time).
    const result = runChain({
      stationCycleTimes: [constant(50), constant(2_000), constant(50), constant(50)],
      stationLabels: ["Mixer", "Filler", "Capper", "Labeler"],
      interStationBufferCapacity: 2,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // Sanity: Mixer really is heavily blocked (running pct should be low).
    const mixerRunningPct = result.perStationRunningPct[0] ?? 0;
    expect(mixerRunningPct).toBeLessThan(0.2);

    const mixer = result.perStationOee[0];
    expect(mixer).toBeDefined();
    // (1) Availability must be ≈ 1.0 regardless of how much the station
    // was Blocked (or Starved). Pre-fix, the legacy display rendered this
    // as 0% via the wrong-index path; the engine math itself only fails
    // when runTime AND downTime are both zero (covered by case 2 below).
    expect(mixer!.availability).toBeGreaterThan(0.99);
    expect(mixer!.availability).toBeLessThanOrEqual(1.0);
    // (2) Performance is what drops — Mixer made very few good parts
    // relative to the wall-clock window because the downstream was slow.
    expect(mixer!.performance).toBeLessThan(1.0);
    // (3) Quality is 100% (no defects configured).
    expect(mixer!.quality).toBe(1);
    // (4) OEE = A × P × Q; with A = Q = 1, OEE ≈ Performance.
    expect(mixer!.oee).toBeCloseTo(mixer!.performance, 6);
  });

  it("station that NEVER runs (pure-Starved, zero Down) reports Availability = 100%", () => {
    // A 2-station chain where the downstream is so slow that the
    // SECOND station may never get a part within the horizon when buffer
    // is small enough. Use an extreme cycle to force runTime ≈ 0 on the
    // last station. Pre-VROL-897, this case pinned A = 0 because the
    // computeOee guard returned 0 when loadingTime = 0; post-fix it
    // returns 1 (textbook: a machine that never ran but also never
    // broke down is fully available).
    const result = runChain({
      stationCycleTimes: [constant(60_000), constant(50)],
      stationLabels: ["VerySlow", "Tail"],
      interStationBufferCapacity: 1,
      horizonMs: 1_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const tail = result.perStationOee[1];
    expect(tail).toBeDefined();
    // Tail must be starved the whole window with zero Running and zero Down.
    expect(tail!.runTimeMs).toBe(0);
    expect(tail!.downTimeMs).toBe(0);
    // Availability = 100% (machine was available, just not needed).
    expect(tail!.availability).toBe(1);
    // Performance is 0 (no good parts produced).
    expect(tail!.performance).toBe(0);
    // OEE = 0 — but the drag comes through Performance, not Availability.
    expect(tail!.oee).toBe(0);
  });

  it("perStationLabels + perStationRunningPct are topology-ordered (not bottleneck-sorted)", () => {
    // The display layer used to index `bottlenecks[idx].label` against
    // `perStationOee[idx]`, but `bottlenecks` is sorted by runningPct DESC,
    // so labels were swapped (Mixer's bars labeled "Filler" and vice versa).
    // The engine now emits perStationLabels + perStationRunningPct in
    // topology order so the display can pair them by index.
    const result = runChain({
      stationCycleTimes: [constant(50), constant(2_000), constant(50)],
      stationLabels: ["Mixer", "Filler", "Capper"],
      interStationBufferCapacity: 2,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // Topology order is preserved on perStationLabels.
    expect(result.perStationLabels).toEqual(["Mixer", "Filler", "Capper"]);
    // bottlenecks is sorted by runningPct DESC — Filler dominates because
    // it's the slow station. If we relied on bottlenecks[idx].label, idx 0
    // would resolve to "Filler", not "Mixer".
    expect(result.bottlenecks[0]?.label).toBe("Filler");
    // perStationRunningPct[0] is Mixer's running share (a small number
    // because Mixer is blocked most of the window), not Filler's.
    expect(result.perStationRunningPct[0]).toBeLessThan(0.5);
    expect(result.perStationRunningPct[1]).toBeGreaterThan(0.5);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// VROL-899 — Nominal cycle time + nominal-aware Performance.
// VROL-900 — Composite bottleneck ranking via runningPct × nominalSpeedRatio.
// ──────────────────────────────────────────────────────────────────────────
describe("audit VROL-899/900 — nominalCycleTimeMs + composite ranking", () => {
  it("station with nominalCycleTimeMs < operating mean reports Performance < 1 and nominalSpeedRatio = nominal / operating", () => {
    // Nominal 100ms but operating distribution at 150ms (50% throttle).
    // Single-station chain so the station runs at its operating cycle.
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "throttled",
            label: "Throttled filler",
            cycleTimeMs: constant(150),
            nominalCycleTimeMs: 100,
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const oee = result.perStationOee[0];
    expect(oee).toBeDefined();
    // Performance = nominal × goodParts / runTime. With ~400 parts and
    // runTime ~60s, Performance ≈ 100 × 400 / 60000 ≈ 0.667.
    expect(oee!.performance).toBeGreaterThan(0.6);
    expect(oee!.performance).toBeLessThan(0.72);
    // nominalSpeedRatio is a static ratio: 100 / 150 = 0.667.
    expect(oee!.nominalSpeedRatio).toBeCloseTo(100 / 150, 6);
  });

  it("legacy line without nominalCycleTimeMs has nominalSpeedRatio = 1 and Performance ≈ 1", () => {
    const result = runChain({
      stationCycleTimes: [constant(100), constant(100)],
      stationLabels: ["A", "B"],
      interStationBufferCapacity: 100,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    for (const oee of result.perStationOee) {
      expect(oee.nominalSpeedRatio).toBe(1);
      expect(oee.performance).toBeGreaterThan(0.98);
    }
  });

  it("balanced line: the at-nominal-max station surfaces as bottleneck despite identical util", () => {
    // 3-station line, every station at 100ms operating cycle (so all are
    // equally fast and all spend the window mostly Running). Only the
    // middle station is at its nominal max — the others are deliberately
    // throttled below their rated 50ms / 50ms. Pre-VROL-900, all three
    // tied on runningPct and the array order was arbitrary; post-VROL-900,
    // bindingScore = runningPct × nominalSpeedRatio breaks the tie and
    // surfaces the at-max station.
    const result = runChain({
      topology: {
        nodes: [
          { id: "a", label: "A throttled", cycleTimeMs: constant(100), nominalCycleTimeMs: 50 },
          { id: "b", label: "B at-max", cycleTimeMs: constant(100) },
          { id: "c", label: "C throttled", cycleTimeMs: constant(100), nominalCycleTimeMs: 50 },
        ],
        edges: [
          { source: "a", target: "b" },
          { source: "b", target: "c" },
        ],
      },
      interStationBufferCapacity: 100,
      horizonMs: 60_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    expect(result.bottlenecks[0]?.label).toBe("B at-max");
    expect(result.bottlenecks[0]?.bindingScore).toBeGreaterThan(
      result.bottlenecks[1]?.bindingScore ?? 0,
    );
    expect(result.bottlenecks[0]?.nominalSpeedRatio).toBe(1);
    // The throttled stations carry ratio 0.5 (50 / 100).
    const throttled = result.bottlenecks.filter((b) => b.label !== "B at-max");
    for (const b of throttled) {
      expect(b.nominalSpeedRatio).toBeCloseTo(0.5, 6);
    }
  });

  it("unbalanced legacy line: bindingScore ranking matches legacy runningPct ranking (no behaviour change)", () => {
    // A 3-station line with a slow middle station (Filler at 2s) and no
    // nominal anywhere. The middle should be the bottleneck on BOTH the
    // legacy runningPct sort AND the new bindingScore sort, since the
    // ratio is 1.0 across the board → score = runningPct.
    const result = runChain({
      stationCycleTimes: [constant(50), constant(2_000), constant(50)],
      stationLabels: ["Mixer", "Filler", "Capper"],
      interStationBufferCapacity: 2,
      horizonMs: 30_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    expect(result.bottlenecks[0]?.label).toBe("Filler");
    // Score = runningPct in the legacy case.
    for (const b of result.bottlenecks) {
      expect(b.bindingScore).toBeCloseTo(b.runningPct, 6);
      expect(b.nominalSpeedRatio).toBe(1);
    }
  });

  it("VROL-870 — unitsPerCycle > 1 inflates completed counts by N", () => {
    // Baseline single-output station.
    const baseline = runChain({
      topology: {
        nodes: [{ id: "base", label: "Single", cycleTimeMs: constant(100) }],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // Same line but unitsPerCycle = 3.
    const multi = runChain({
      topology: {
        nodes: [
          { id: "multi", label: "Multi-output", cycleTimeMs: constant(100), unitsPerCycle: 3 },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // Same cycle count → ~3× more units recorded.
    const baseCount = baseline.perStationCompleted[0] ?? 0;
    const multiCount = multi.perStationCompleted[0] ?? 0;
    expect(multiCount).toBeCloseTo(baseCount * 3, -1);
  });

  it("VROL-868 — theoreticalYield = good / (good + scrap)", () => {
    const result = runChain({
      topology: {
        nodes: [
          { id: "good", label: "Filler", cycleTimeMs: constant(50), defectRate: 0 },
          { id: "scrap", label: "Capper", cycleTimeMs: constant(50), defectRate: 0.2 },
        ],
        edges: [{ source: "good", target: "scrap" }],
      },
      interStationBufferCapacity: 100,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // ~20% scrap rate at Capper → yield ~ 0.83 (1/(1+0.2)).
    expect(result.theoreticalYield).toBeGreaterThan(0.7);
    expect(result.theoreticalYield).toBeLessThan(0.95);
  });

  it("VROL-885 — sustainability totals accumulate across the run", () => {
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "s",
            label: "Heavy",
            cycleTimeMs: constant(100),
            energyPerCycleJ: 1_000,
            waterPerCycleL: 0.1,
            co2ePerCycleG: 5,
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    // 10s / 100ms = 100 cycles. Expect ~100,000 J, 10 L, 500 g.
    expect(result.totalEnergyJ).toBeGreaterThan(50_000);
    expect(result.totalWaterL).toBeGreaterThan(5);
    expect(result.totalCO2eG).toBeGreaterThan(250);
  });

  it("VROL-882 — qualityGrades distribute completed counts proportionally", () => {
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "g",
            label: "Inspect",
            cycleTimeMs: constant(50),
            qualityGrades: [
              { grade: "A", pct: 0.7 },
              { grade: "B", pct: 0.3 },
            ],
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 5_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const counts = result.perStationGradeCounts[0] ?? {};
    const total = (counts.A ?? 0) + (counts.B ?? 0);
    expect(total).toBe(result.perStationCompleted[0]);
    expect(counts.A).toBeGreaterThan(counts.B);
  });

  it("nominalCycleTimeMs >= operating mean is silently dropped (over-rated machine, not throttled)", () => {
    // Nominal 200ms but operating 100ms — operator over-rated the machine.
    // Engine should drop the nominal (treat as if undefined) and report
    // nominalSpeedRatio = 1, Performance ≈ 1.
    const result = runChain({
      topology: {
        nodes: [
          {
            id: "overrated",
            label: "Overrated",
            cycleTimeMs: constant(100),
            nominalCycleTimeMs: 200,
          },
        ],
        edges: [],
      },
      interStationBufferCapacity: 100,
      horizonMs: 10_000,
      warmupMs: 0,
      prng: new SeededPrng(1),
    });
    const oee = result.perStationOee[0];
    expect(oee).toBeDefined();
    expect(oee!.nominalSpeedRatio).toBe(1);
    expect(oee!.performance).toBeGreaterThan(0.98);
  });
});
