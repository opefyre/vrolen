/**
 * VROL-686 — per-edge buffer fill summary. Reads samples and computes
 * average + peak fill per edge, ranks descending by average. Hides when
 * no samples or zero edges.
 *
 * VROL-792 — rows now show human "source → target" station labels rather
 * than opaque edge indices. Labels are derived from stationLabels +
 * (chainNodeIds, edgeKeys). When edge mapping is missing we fall back to
 * "edge N" so the card still renders.
 */

import type { ChainResult } from "@/engine";

interface BufferSummaryProps {
  readonly result: ChainResult;
  /** Display labels for each station, aligned with chainNodeIds. */
  readonly stationLabels?: readonly string[];
  /** Chain-order station ids; index aligns with stationLabels. */
  readonly chainNodeIds?: readonly string[];
  /** "sourceNodeId→targetNodeId" keys in engine edge order. */
  readonly edgeKeys?: readonly string[];
}

interface EdgeStat {
  readonly idx: number;
  readonly avg: number;
  readonly peak: number;
  readonly flowed: number;
}

function rankEdgesByAverage(result: ChainResult): readonly EdgeStat[] {
  const edges = result.perEdgeFlowed?.length ?? 0;
  if (edges === 0) return [];
  const sums = new Array<number>(edges).fill(0);
  const peaks = new Array<number>(edges).fill(0);
  let n = 0;
  for (const s of result.samples) {
    const fill = s.perEdgeBufferFill;
    if (!fill || fill.length === 0) continue;
    for (let i = 0; i < edges; i++) {
      const v = fill[i] ?? 0;
      sums[i] = (sums[i] ?? 0) + v;
      if (v > (peaks[i] ?? 0)) peaks[i] = v;
    }
    n++;
  }
  const out: EdgeStat[] = [];
  for (let i = 0; i < edges; i++) {
    out.push({
      idx: i,
      avg: n > 0 ? (sums[i] ?? 0) / n : 0,
      peak: peaks[i] ?? 0,
      flowed: result.perEdgeFlowed[i] ?? 0,
    });
  }
  return out.sort((a, b) => b.avg - a.avg);
}

/**
 * Map an edge index to a "Source → Target" label. Returns null when the
 * required metadata is missing or the edge key doesn't resolve to two known
 * stations — caller falls back to "edge N".
 */
function resolveEdgeLabel(
  edgeIdx: number,
  stationLabels: readonly string[] | undefined,
  chainNodeIds: readonly string[] | undefined,
  edgeKeys: readonly string[] | undefined,
): string | null {
  if (!stationLabels || stationLabels.length === 0) return null;
  // Linear chain fallback: edge i sits between station i and station i+1.
  if (!edgeKeys || !chainNodeIds) {
    const src = stationLabels[edgeIdx];
    const tgt = stationLabels[edgeIdx + 1];
    if (src && tgt) return `${src} → ${tgt}`;
    return null;
  }
  const key = edgeKeys[edgeIdx];
  if (!key) return null;
  const arrowIdx = key.indexOf("→");
  if (arrowIdx < 0) return null;
  const sourceNodeId = key.slice(0, arrowIdx);
  const targetNodeId = key.slice(arrowIdx + 1);
  const srcStationIdx = chainNodeIds.indexOf(sourceNodeId);
  const tgtStationIdx = chainNodeIds.indexOf(targetNodeId);
  const src = srcStationIdx >= 0 ? stationLabels[srcStationIdx] : undefined;
  const tgt = tgtStationIdx >= 0 ? stationLabels[tgtStationIdx] : undefined;
  if (src && tgt) return `${src} → ${tgt}`;
  return null;
}

export function BufferSummary({
  result,
  stationLabels,
  chainNodeIds,
  edgeKeys,
}: BufferSummaryProps) {
  const stats = rankEdgesByAverage(result);
  if (stats.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        No buffer samples — enable <strong>Sample throughput over time</strong> in Run settings to
        populate this card.
      </p>
    );
  }
  const globalPeak = stats.reduce((m, s) => Math.max(m, s.peak), 0);
  return (
    <ul className="space-y-1" data-testid="buffer-summary">
      {stats.map((s) => {
        const widthAvg = globalPeak > 0 ? Math.round((s.avg / globalPeak) * 100) : 0;
        const resolved = resolveEdgeLabel(s.idx, stationLabels, chainNodeIds, edgeKeys);
        const label = resolved ?? `edge ${String(s.idx)}`;
        const isFallback = resolved === null;
        return (
          <li key={s.idx} className="flex items-center gap-2 text-xs">
            <span
              className={
                isFallback
                  ? "w-32 shrink-0 truncate font-mono"
                  : "w-32 shrink-0 truncate font-medium"
              }
              title={label}
            >
              {label}
            </span>
            <div className="bg-muted relative h-3 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-sim-running h-full rounded-full"
                style={{ width: `${String(Math.max(1, widthAvg))}%` }}
                title={`avg ${s.avg.toFixed(1)} · peak ${s.peak.toLocaleString()}`}
              />
            </div>
            <span className="text-muted-foreground w-32 text-right font-mono tabular-nums">
              avg {s.avg.toFixed(1)} · peak {s.peak.toLocaleString()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
