/**
 * VROL-366 / VROL-1154-1155 — pure helpers over the existing
 * run-history layer. The run-history.ts side owns persistence; this
 * file owns the read-side transformations the future history-view UI
 * (and the existing strip) consume.
 *
 * Pure functions: input arrays in, derived arrays out. No I/O.
 */

import type { RunHistoryEntryWithScenario } from "./run-history";

export type RunHistorySortOrder = "recent" | "throughput-desc" | "oee-desc";

/**
 * VROL-1154 — filter + sort. Query matches the scenario name, the
 * bottleneck label (when present), and the run's ISO date. Empty
 * query → all entries pass.
 */
export function filterRunHistory(
  entries: readonly RunHistoryEntryWithScenario[],
  query: string,
  order: RunHistorySortOrder = "recent",
): readonly RunHistoryEntryWithScenario[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? entries.filter((e) => {
        if (e.scenarioName.toLowerCase().includes(q)) return true;
        if (e.bottleneckLabel?.toLowerCase().includes(q)) return true;
        const iso = new Date(e.runAtMs).toISOString().slice(0, 10);
        if (iso.includes(q)) return true;
        return false;
      })
    : [...entries];
  filtered.sort((a, b) => compareEntries(a, b, order));
  return filtered;
}

function compareEntries(
  a: RunHistoryEntryWithScenario,
  b: RunHistoryEntryWithScenario,
  order: RunHistorySortOrder,
): number {
  switch (order) {
    case "recent":
      return b.runAtMs - a.runAtMs;
    case "throughput-desc":
      return b.throughputLambda - a.throughputLambda;
    case "oee-desc":
      return b.lineOee - a.lineOee;
  }
}

/**
 * VROL-1155 — adjacent-pair deltas. Input is a list ordered however
 * the caller wants (typically by recency); we compute (next, prev,
 * deltas) for every pair. Used by the history strip's "how did
 * this run compare to the previous one?" chip.
 *
 * Empty input or single-entry list → empty result.
 */
export interface ConsecutiveDelta {
  readonly prev: RunHistoryEntryWithScenario;
  readonly curr: RunHistoryEntryWithScenario;
  readonly deltas: {
    readonly throughputLambdaDelta: number;
    readonly lineOeeDelta: number;
    /** runAtMs(curr) - runAtMs(prev). Often negative when sorted by recency. */
    readonly elapsedMsDelta: number;
  };
}

export function consecutiveRunDeltas(
  entries: readonly RunHistoryEntryWithScenario[],
): readonly ConsecutiveDelta[] {
  if (entries.length < 2) return [];
  const out: ConsecutiveDelta[] = [];
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1]!;
    const curr = entries[i]!;
    out.push({
      prev,
      curr,
      deltas: {
        throughputLambdaDelta: curr.throughputLambda - prev.throughputLambda,
        lineOeeDelta: curr.lineOee - prev.lineOee,
        elapsedMsDelta: curr.runAtMs - prev.runAtMs,
      },
    });
  }
  return out;
}
