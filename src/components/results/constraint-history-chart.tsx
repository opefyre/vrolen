/**
 * VROL-932 — horizontal lane chart of the binding station over time.
 *
 * Renders one colored band per interval whose width is proportional to the
 * interval's duration. Hover shows the interval window and the station's
 * running-share. A horizontal legend lists the stations that ever held the
 * constraint in the run (the ones not shown were never the busiest).
 */

import type { ChainResult } from "@/engine";
import { computeConstraintHistory } from "@/lib/constraint-history";

interface Props {
  readonly result: ChainResult;
}

// Small qualitative palette — wraps around at 8.
const PALETTE = [
  "var(--sim-running)",
  "var(--sim-setup)",
  "var(--sim-maintenance)",
  "var(--sim-blocked-out)",
  "var(--sim-starved)",
  "var(--sim-down)",
  "var(--accent)",
  "var(--primary)",
];

export function ConstraintHistoryChart({ result }: Props) {
  const intervals = computeConstraintHistory(result);
  if (intervals.length === 0) return null;
  const tStart = intervals[0]!.fromMs;
  const tEnd = intervals[intervals.length - 1]!.toMs;
  const span = Math.max(1, tEnd - tStart);
  // De-dup stations that ever held the constraint, preserving topology order.
  const everSeen = new Map<number, string>();
  for (const iv of intervals) everSeen.set(iv.stationIdx, iv.stationLabel);
  const sortedSeen = [...everSeen.entries()].sort(([a], [b]) => a - b);
  return (
    <div className="border-border bg-card space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-medium">Constraint history</h3>
        <span className="text-muted-foreground text-[10px]">
          {(span / 1000).toFixed(1)}s window
        </span>
      </div>
      <p className="text-muted-foreground text-[11px] leading-snug">
        Which station was the empirical bottleneck moment-by-moment. Choppy bands → the constraint
        shifted as buffers filled. Solid lane → one station was always the binder.
      </p>
      <div
        className="flex h-6 overflow-hidden rounded-md"
        data-testid="constraint-history"
        role="img"
        aria-label="constraint history timeline"
      >
        {intervals.map((iv, i) => {
          const widthPct = ((iv.toMs - iv.fromMs) / span) * 100;
          const color = PALETTE[iv.stationIdx % PALETTE.length];
          return (
            <div
              key={i}
              style={{ width: `${widthPct.toFixed(3)}%`, backgroundColor: color }}
              title={`${iv.stationLabel} • ${(iv.fromMs / 1000).toFixed(1)}s–${(iv.toMs / 1000).toFixed(1)}s • ${Math.round(iv.runningPct * 100)}% Running`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {sortedSeen.map(([idx, label]) => (
          <div key={idx} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: PALETTE[idx % PALETTE.length] }}
            />
            <span className="text-muted-foreground text-[11px]">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
