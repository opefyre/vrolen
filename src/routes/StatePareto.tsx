/**
 * VROL-667 — per-station Pareto chart. Sorts the bottleneck breakdown
 * descending by share and renders as horizontal bars so users see at a
 * glance which states dominate.
 */

import type { ChainResult } from "@/engine";

interface StateParetoProps {
  readonly result: ChainResult;
}

const STATE_COLOR: Record<string, string> = {
  Running: "bg-sim-running",
  Starved: "bg-sim-starved",
  BlockedOut: "bg-sim-blocked",
  Down: "bg-sim-down",
  Setup: "bg-sim-setup",
  Maintenance: "bg-sim-maintenance",
  Idle: "bg-sim-idle",
};

export function StatePareto({ result }: StateParetoProps) {
  const top = result.bottlenecks[0];
  if (!top) return null;
  const sorted = [...top.breakdown].sort((a, b) => b.pct - a.pct);
  return (
    <div className="space-y-1.5" data-testid="state-pareto">
      <div className="text-muted-foreground text-xs">
        Time at <strong className="text-foreground">{top.label ?? "bottleneck"}</strong>, sorted by
        share
      </div>
      <ul className="space-y-1">
        {sorted.map((row) => {
          const pct = Math.round(row.pct * 100);
          const colorClass = STATE_COLOR[row.state] ?? "bg-muted";
          return (
            <li key={row.state} className="flex items-center gap-2 text-xs">
              <span className="w-24 shrink-0 truncate">{row.state}</span>
              <div className="bg-muted relative h-3 flex-1 overflow-hidden rounded-full">
                <div
                  className={`${colorClass} h-full rounded-full`}
                  style={{ width: `${String(Math.max(1, pct))}%` }}
                  title={`${row.state} ${String(pct)}%`}
                />
              </div>
              <span className="w-10 text-right font-mono tabular-nums">{String(pct)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
