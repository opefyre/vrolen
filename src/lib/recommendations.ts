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

export type RecommendationSeverity = "high" | "medium" | "low";

export interface Recommendation {
  readonly id: string;
  readonly severity: RecommendationSeverity;
  readonly title: string;
  readonly body: string;
}

const PCT = (n: number): string => `${(n * 100).toFixed(0)}%`;

export function deriveRecommendations(result: ChainResult): readonly Recommendation[] {
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

  // Cap at 4; pre-sorted by insertion order (already by impact).
  return out.slice(0, 4);
}
