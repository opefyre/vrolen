/**
 * VROL-678 — auto-derived recommendations from a ChainResult.
 *
 * The narration / bottleneck cards explain what *is*; recommendations
 * explain what *to do*. Each recommendation has a short title, a 1-2
 * sentence body, and a severity. Generated deterministically from
 * bottleneck running %, dominant non-running state, OEE sub-metrics, and
 * scrap / rework totals.
 *
 * Keep it short: ≤4 cards, ranked by expected impact.
 */

import type { ChainResult } from "@/engine";
import { computeBufferCoverage, type BufferCoverageInput } from "./buffer-coverage";
import type { Distribution } from "@/engine/distribution";

export type RecommendationSeverity = "high" | "medium" | "low";

/**
 * VROL-796 — Structured apply payload. Each kind targets a different patch:
 *   • cycle:halve         — halve the named station's operating cycle
 *   • buffer:grow         — grow the named edge's buffer to a recommended size
 *   • cycle:throttle10    — slow the named station's cycle by 10% (sweet spot)
 *   • defect:halve        — halve the named station's defect rate
 * The Recommendations card surfaces an Apply button when this is set;
 * EditorPage receives the payload and applies the patch + re-runs.
 */
export type RecommendationApply =
  | { readonly kind: "cycle:halve"; readonly stationLabel: string }
  | {
      readonly kind: "buffer:grow";
      readonly edgeId: string;
      readonly recommendedCapacity: number;
    }
  | { readonly kind: "cycle:throttle10"; readonly stationLabel: string }
  | { readonly kind: "defect:halve"; readonly stationLabel: string };

export interface Recommendation {
  readonly id: string;
  readonly severity: RecommendationSeverity;
  readonly title: string;
  readonly body: string;
  /** VROL-796 — when set, the card renders an Apply button. */
  readonly apply?: RecommendationApply;
  /** VROL-796 — rough back-of-envelope estimate, e.g. "≈ +30% throughput". */
  readonly previewLabel?: string;
}

/**
 * VROL-902 / VROL-903 — optional context for buffer-coverage + sweet-spot
 * recommendations. Both checks require data the engine doesn't carry on the
 * ChainResult (MTTR distribution and per-edge labels). Passed in by the
 * caller — Recommendations card lookup site in the result panel.
 */
export interface RecommendationContext {
  readonly mttrDistribution?: Distribution;
  readonly bufferEdges?: ReadonlyArray<BufferCoverageInput>;
}

const PCT = (n: number): string => `${(n * 100).toFixed(0)}%`;

export function deriveRecommendations(
  result: ChainResult,
  context: RecommendationContext = {},
): readonly Recommendation[] {
  const out: Recommendation[] = [];

  const bottlenecks = [...result.bottlenecks].sort((a, b) => b.runningPct - a.runningPct);
  const head = bottlenecks[0];
  if (head) {
    const label = head.label ?? String(head.stationId);
    if (head.primaryReason === "running") {
      out.push({
        id: "speed-bottleneck",
        severity: "high",
        title: `Speed up ${label}`,
        body: `${label} is the constraint, running ${PCT(head.runningPct)} of the time. Lowering its cycle time lifts the entire line — other stations have idle capacity to absorb the faster pace.`,
        // VROL-796 — Apply halves the bottleneck's operating cycle. Rough
        // estimate: line throughput approaches 2× the current rate until the
        // next-slowest station takes over as the new constraint.
        apply: { kind: "cycle:halve", stationLabel: label },
        previewLabel: "≈ up to +50% throughput",
      });
    } else {
      out.push({
        id: "reduce-non-running",
        severity: "high",
        title: `Reduce ${head.primaryReason} at ${label}`,
        body: `${label} spends ${PCT(head.primaryReasonPct)} in ${head.primaryReason} — that's its biggest loss. Cut it before touching cycle time.`,
      });
    }
  }

  // Quality leakage: high scrap or rework
  const totalScrapped = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalReworked = result.perStationReworked.reduce((a, b) => a + b, 0);
  const totalAttempts = result.completed + totalScrapped + totalReworked;
  if (totalAttempts > 0) {
    const scrapPct = totalScrapped / totalAttempts;
    if (scrapPct > 0.05) {
      out.push({
        id: "cut-scrap",
        severity: scrapPct > 0.1 ? "high" : "medium",
        title: "Cut scrap rate",
        body: `${PCT(scrapPct)} of attempted parts were scrapped. Tighten defect inspection or reduce defect-rate at the worst station.`,
      });
    }
  }

  // OEE-quality drag
  const worstQuality = [...result.perStationOee]
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.totalParts > 50)
    .sort((a, b) => a.m.quality - b.m.quality)[0];
  if (worstQuality && worstQuality.m.quality < 0.9) {
    const idx = worstQuality.i;
    const label =
      result.perStationLabels?.[idx] ?? bottlenecks[idx]?.label ?? `Station ${String(idx)}`;
    out.push({
      id: "quality-drag",
      severity: worstQuality.m.quality < 0.75 ? "high" : "medium",
      title: `Improve quality at ${label}`,
      body: `${label} ships ${PCT(worstQuality.m.quality)} good parts. Each defect cascades to scrap or rework, dragging line efficiency down.`,
    });
  }

  // Availability drag
  const worstAvail = [...result.perStationOee]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.availability - b.m.availability)[0];
  if (worstAvail && worstAvail.m.availability < 0.8) {
    const idx = worstAvail.i;
    const label =
      result.perStationLabels?.[idx] ?? bottlenecks[idx]?.label ?? `Station ${String(idx)}`;
    out.push({
      id: "availability-drag",
      severity: worstAvail.m.availability < 0.6 ? "high" : "medium",
      title: `Boost ${label} availability`,
      body: `${label} runs only ${PCT(worstAvail.m.availability)} of available time. Investigate breakdowns, planned maintenance windows, or starvation upstream.`,
    });
  }

  // VROL-902 — tightly-coupled line warning. Surfaces only when (a) MTTR is
  // configured AND (b) at least one buffer can't absorb one mean breakdown.
  // Silent for breakdown-free lines, so users don't see scary warnings on
  // scenarios where they haven't modelled failures yet.
  if (context.mttrDistribution && context.bufferEdges && context.bufferEdges.length > 0) {
    const coverage = computeBufferCoverage({
      throughputLambda: result.throughputLambda,
      mttrDistribution: context.mttrDistribution,
      edges: context.bufferEdges,
    });
    const worst = coverage
      .filter((c) => c.tightlyCoupled)
      .sort((a, b) => a.coverageRatio - b.coverageRatio)[0];
    if (worst) {
      out.push({
        id: "tightly-coupled",
        severity: worst.coverageRatio < 0.5 ? "high" : "medium",
        title: `Grow buffer ${worst.label ?? worst.edgeId}`,
        body: `Capacity ${worst.capacity} parts covers ${(worst.coverageRatio * 100).toFixed(0)}% of one mean breakdown. Line stalls every time this station goes Down. Suggest sizing to ${worst.recommendedCapacity} parts (1.5× absorption).`,
        // VROL-796 — Apply sets the interStationBufferCapacity setting to the
        // recommended size. Rough estimate: recovers most of the throughput
        // lost to breakdown-induced stalls.
        apply: {
          kind: "buffer:grow",
          edgeId: worst.edgeId,
          recommendedCapacity: worst.recommendedCapacity,
        },
        previewLabel: "≈ +10–25% throughput on breakdown-heavy lines",
      });
    }
  }

  // VROL-903 — sweet-spot recommendation. A NON-bottleneck station running
  // > 95% of nominal AND with non-zero defect rate OR breakdown count is
  // leaving uptime on the table. The line is bottleneck-bound; running this
  // station flat-out doesn't lift throughput but does shorten MTBF.
  if (result.bottlenecks.length > 0) {
    const bottleneck = result.bottlenecks[0];
    const breakdowns = result.perStationBreakdowns ?? [];
    for (const cand of result.bottlenecks) {
      if (cand === bottleneck) continue;
      if (cand.nominalSpeedRatio < 0.95) continue;
      const idx = result.perStationLabels?.indexOf(cand.label ?? "") ?? -1;
      const defectRate = idx >= 0 ? 1 - (result.perStationOee[idx]?.quality ?? 1) : 0;
      const breakdownCount = idx >= 0 ? (breakdowns[idx] ?? 0) : 0;
      if (defectRate <= 0 && breakdownCount <= 0) continue;
      const label = cand.label ?? String(cand.stationId);
      out.push({
        id: `sweet-spot-${label}`,
        severity: "low",
        title: `Throttle ${label} to ~90% of nominal`,
        body: `${label} is at ${(cand.nominalSpeedRatio * 100).toFixed(0)}% of nominal and the line is bottleneck-bound. Running flat-out raises breakdowns and quality losses you can't trade for throughput. The 85–95% sweet spot extends MTBF for free.`,
        // VROL-796 — Apply slows the operating cycle by ~10% to reach the
        // sweet spot. No throughput change expected; MTBF improvement is
        // the win (not captured in a one-run sim, but the canvas state mix
        // will visibly relax).
        apply: { kind: "cycle:throttle10", stationLabel: label },
        previewLabel: "≈ MTBF lift; throughput unchanged",
      });
      break;
    }
  }

  // Cap at 4; pre-sorted by insertion order (already by impact).
  return out.slice(0, 4);
}
