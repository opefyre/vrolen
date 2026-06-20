/**
 * VROL-686 — per-edge buffer fill summary. Reads samples and computes
 * average + peak fill per edge, ranks descending by average. Hides when
 * no samples or zero edges.
 */

import type { ChainResult } from "@/engine";

interface BufferSummaryProps {
  readonly result: ChainResult;
}

interface EdgeStat {
  readonly idx: number;
  readonly avg: number;
  readonly peak: number;
  readonly flowed: number;
}

function buildEdgeStats(result: ChainResult): readonly EdgeStat[] {
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

export function BufferSummary({ result }: BufferSummaryProps) {
  const stats = buildEdgeStats(result);
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
        return (
          <li key={s.idx} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 font-mono">edge {s.idx}</span>
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
