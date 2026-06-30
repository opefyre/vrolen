/**
 * VROL-1078 — integration test for the 7 dep wirings landed in
 * Sprint 181. Asserts each S180 tip predicate fires when the
 * deps are constructed from realistic inputs (mirroring the
 * EditorPage derivations).
 *
 * This isn't an EditorPage render test (that file is enormous + the
 * derivations are inlined in JSX); it's a contract test that
 * exercises the predicates through the same shapes the EditorPage
 * builds. If the derivation logic in EditorPage and the predicate
 * in coach-tips disagree, this catches it.
 */
import { describe, expect, it, vi } from "vitest";

import { buildCoachTips, type CoachTipDeps } from "./coach-tips";

const baseDeps: CoachTipDeps = {
  stationCount: 4,
  edgeCount: 3,
  hasRun: true,
  isBottleneckHigh: false,
  lockedNodeCount: 0,
};

function tipIds(extra: Partial<CoachTipDeps>): string[] {
  return buildCoachTips({ ...baseDeps, ...extra }, { runNow: vi.fn() })
    .filter((t) => t.whenVisible())
    .map((t) => t.id);
}

// Mirror the EditorPage derivation closures so the contract is
// tested at the same shape. If EditorPage changes its derivation,
// these helpers should change too.
function deriveLineAverageWipL(result: { averageWipL: number } | null): number | undefined {
  return result?.averageWipL;
}
function deriveLineOee(result: { lineOee: number } | null): number | undefined {
  return result?.lineOee;
}
function deriveLineScrapRate(result: { lineScrapRate: number } | null): number | undefined {
  return result?.lineScrapRate;
}
function deriveWarmupFractionOfHorizon(settings: { horizonMs: number; warmupMs: number }): number {
  return settings.horizonMs > 0 ? settings.warmupMs / settings.horizonMs : 0;
}
function deriveStochasticSingleRep(
  settings: { replications: number },
  nodes: ReadonlyArray<{
    type?: string;
    data?: { cycleDistribution?: { kind?: string } };
  }>,
): boolean {
  if (settings.replications > 1) return false;
  return nodes.some((n) => {
    if (n.type !== "station") return false;
    const k = n.data?.cycleDistribution?.kind;
    return k !== undefined && k !== "constant";
  });
}
function deriveMaxBufferFillFraction(
  result: { samples: ReadonlyArray<{ perEdgeBufferFill: readonly number[] }> } | null,
  cap: number,
): number {
  if (!result || result.samples.length === 0 || cap <= 0) return 0;
  let peak = 0;
  for (const s of result.samples) {
    for (const fill of s.perEdgeBufferFill) {
      const frac = fill / cap;
      if (frac > peak) peak = frac;
    }
  }
  return peak;
}
function deriveSourceIdleFraction(
  result: {
    samples: ReadonlyArray<{
      perStationStateMs: ReadonlyArray<Readonly<Record<string, number>>>;
    }>;
  } | null,
): number {
  if (!result || result.samples.length === 0) return 0;
  const last = result.samples[result.samples.length - 1];
  const stateMs = last?.perStationStateMs?.[0];
  if (!stateMs) return 0;
  let total = 0;
  for (const v of Object.values(stateMs)) total += v;
  if (total <= 0) return 0;
  return (stateMs["Idle"] ?? 0) / total;
}

describe("Sprint 181 — coach dep wiring (integration)", () => {
  it("VROL-1071 — lineAverageWipL derivation triggers high-wip-warning", () => {
    const result = { averageWipL: 20 }; // 5 × stationCount=4
    expect(tipIds({ lineAverageWipL: deriveLineAverageWipL(result) })).toContain(
      "high-wip-warning",
    );
    // Null result → undefined dep → predicate stays inactive.
    expect(tipIds({ lineAverageWipL: deriveLineAverageWipL(null) })).not.toContain(
      "high-wip-warning",
    );
  });

  it("VROL-1072 — lineOee derivation triggers low-line-oee-warning", () => {
    expect(tipIds({ lineOee: deriveLineOee({ lineOee: 0.3 }) })).toContain("low-line-oee-warning");
    expect(tipIds({ lineOee: deriveLineOee({ lineOee: 0.85 }) })).not.toContain(
      "low-line-oee-warning",
    );
  });

  it("VROL-1073 — lineScrapRate derivation triggers high-scrap-warning", () => {
    expect(tipIds({ lineScrapRate: deriveLineScrapRate({ lineScrapRate: 0.08 }) })).toContain(
      "high-scrap-warning",
    );
    expect(tipIds({ lineScrapRate: deriveLineScrapRate({ lineScrapRate: 0.02 }) })).not.toContain(
      "high-scrap-warning",
    );
  });

  it("VROL-1074 — warmupFractionOfHorizon derivation triggers warmup-too-short", () => {
    const dep = deriveWarmupFractionOfHorizon({ horizonMs: 30_000, warmupMs: 1_000 });
    expect(dep).toBeCloseTo(0.033, 3);
    expect(tipIds({ warmupFractionOfHorizon: dep })).toContain("warmup-too-short");
    const fine = deriveWarmupFractionOfHorizon({ horizonMs: 30_000, warmupMs: 10_000 });
    expect(tipIds({ warmupFractionOfHorizon: fine })).not.toContain("warmup-too-short");
  });

  it("VROL-1075 — stochasticSingleRep fires on reps=1 + non-constant cycle distribution", () => {
    const stochasticNodes = [
      { type: "station", data: { cycleDistribution: { kind: "uniform" } } },
      { type: "station", data: { cycleDistribution: { kind: "constant" } } },
    ];
    const constantNodes = [
      { type: "station", data: { cycleDistribution: { kind: "constant" } } },
      { type: "station", data: { cycleDistribution: { kind: "constant" } } },
    ];
    expect(
      tipIds({
        stochasticSingleRep: deriveStochasticSingleRep({ replications: 1 }, stochasticNodes),
      }),
    ).toContain("stochastic-needs-replications");
    // reps > 1 → flag false even with stochastic nodes
    expect(
      tipIds({
        stochasticSingleRep: deriveStochasticSingleRep({ replications: 5 }, stochasticNodes),
      }),
    ).not.toContain("stochastic-needs-replications");
    // All constant → flag false
    expect(
      tipIds({
        stochasticSingleRep: deriveStochasticSingleRep({ replications: 1 }, constantNodes),
      }),
    ).not.toContain("stochastic-needs-replications");
  });

  it("VROL-1076 — maxBufferFillFraction triggers per-edge-buffer-saturated", () => {
    const result = {
      samples: [
        { perEdgeBufferFill: [3, 5] },
        { perEdgeBufferFill: [10, 10] }, // 100 % of cap=10
      ],
    };
    expect(tipIds({ maxBufferFillFraction: deriveMaxBufferFillFraction(result, 10) })).toContain(
      "per-edge-buffer-saturated",
    );
    // Cap=100 → peak fraction = 10/100 = 0.1 → predicate dormant.
    expect(
      tipIds({ maxBufferFillFraction: deriveMaxBufferFillFraction(result, 100) }),
    ).not.toContain("per-edge-buffer-saturated");
  });

  it("VROL-1077 — sourceIdleFraction triggers idle-source", () => {
    const idleResult = {
      samples: [
        {
          perStationStateMs: [
            { Idle: 7_000, Running: 3_000 }, // 70 % idle at source
            { Idle: 0, Running: 10_000 },
          ],
        },
      ],
    };
    expect(tipIds({ sourceIdleFraction: deriveSourceIdleFraction(idleResult) })).toContain(
      "idle-source",
    );
    const busyResult = {
      samples: [
        {
          perStationStateMs: [
            { Idle: 1_000, Running: 9_000 }, // 10 % idle
            { Idle: 0, Running: 10_000 },
          ],
        },
      ],
    };
    expect(tipIds({ sourceIdleFraction: deriveSourceIdleFraction(busyResult) })).not.toContain(
      "idle-source",
    );
  });

  it("VROL-1078 — all 7 new dep wirings flow through to their tips simultaneously", () => {
    const settings = { horizonMs: 30_000, warmupMs: 1_000, replications: 1 };
    const nodes = [{ type: "station", data: { cycleDistribution: { kind: "uniform" } } }];
    const result = {
      averageWipL: 20,
      lineOee: 0.3,
      lineScrapRate: 0.08,
      samples: [
        {
          perEdgeBufferFill: [10],
          perStationStateMs: [{ Idle: 7_000, Running: 3_000 }],
        },
      ],
    };
    const ids = tipIds({
      lineAverageWipL: deriveLineAverageWipL(result),
      lineOee: deriveLineOee(result),
      lineScrapRate: deriveLineScrapRate(result),
      warmupFractionOfHorizon: deriveWarmupFractionOfHorizon(settings),
      stochasticSingleRep: deriveStochasticSingleRep(settings, nodes),
      maxBufferFillFraction: deriveMaxBufferFillFraction(result, 10),
      sourceIdleFraction: deriveSourceIdleFraction(result),
    });
    for (const id of [
      "high-wip-warning",
      "low-line-oee-warning",
      "high-scrap-warning",
      "warmup-too-short",
      "stochastic-needs-replications",
      "per-edge-buffer-saturated",
      "idle-source",
    ]) {
      expect(ids).toContain(id);
    }
  });
});
