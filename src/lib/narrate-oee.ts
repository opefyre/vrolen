/**
 * VROL-952 — plain-language OEE summary derived from a ChainResult.
 *
 * Designed to surface above the per-station OEE breakdown so a reader
 * who hasn't internalised Availability × Performance × Quality gets the
 * headline first: "1,820 parts/h. Performance is the slim factor (62 %)
 * — Filler is running below its OEM-rated max."
 *
 * Pure function; no LLM call. The narration only mentions facts that
 * are *true* of the run — no inferred mitigation language.
 */

import type { ChainResult } from "@/engine";

function pct(v: number): string {
  return `${(v * 100).toFixed(0)} %`;
}

function fmtPerHour(throughputPerMs: number): string {
  const perHour = throughputPerMs * 3_600_000;
  return `${Math.round(perHour).toLocaleString()} parts/h`;
}

interface NarrationPart {
  readonly key: string;
  readonly text: string;
}

/**
 * Build a list of narration sentences. Callers join with a space (or
 * render each as its own paragraph for emphasis).
 */
export function narrateOee(result: ChainResult): readonly NarrationPart[] {
  if (result.perStationOee.length === 0) return [];
  const parts: NarrationPart[] = [];
  parts.push({
    key: "throughput",
    text: `This line completes ${fmtPerHour(result.throughputLambda ?? 0)} (${(result.completed ?? 0).toLocaleString()} parts in ${((result.elapsedMs ?? 0) / 1000).toFixed(0)} s of operating time).`,
  });

  // Slim factor — average of the three OEE components weighted by the
  // bottleneck station's running share so the narration speaks to the
  // station that matters most.
  const top = result.bottlenecks[0];
  if (top) {
    const topOee = result.perStationOee.find(
      (_, idx) => result.perStationLabels?.[idx] === top.label,
    );
    if (topOee) {
      const slim = Math.min(topOee.availability, topOee.performance, topOee.quality);
      const slimLabel =
        slim === topOee.availability
          ? "Availability"
          : slim === topOee.performance
            ? "Performance"
            : "Quality";
      parts.push({
        key: "slim",
        text: `${slimLabel} is the slim factor at the bottleneck (${pct(slim)}). Line OEE is ${pct(result.lineOee)}.`,
      });
    } else {
      parts.push({
        key: "line-oee",
        text: `Line OEE is ${pct(result.lineOee)}.`,
      });
    }
    const binding = top.bindingScore ?? top.runningPct ?? 0;
    parts.push({
      key: "bottleneck",
      text: `${top.label} is the binding constraint (${pct(binding)} of the window).`,
    });
  } else {
    parts.push({
      key: "line-oee",
      text: `Line OEE is ${pct(result.lineOee)}.`,
    });
  }

  // Scrap callout when material loss is meaningful.
  if (result.lineScrapRate > 0.05) {
    parts.push({
      key: "scrap",
      text: `Scrap rate is ${pct(result.lineScrapRate)} — material loss is non-trivial here.`,
    });
  }

  return parts;
}
