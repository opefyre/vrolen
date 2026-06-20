/**
 * VROL-687 — final state snapshot. For each station, find its dominant
 * state in the LAST sample (closest proxy to "state at horizon end").
 * Useful for diagnosing chains that ended starved / blocked / down.
 */

import type { ChainResult } from "@/engine";

interface FinalStateCardProps {
  readonly result: ChainResult;
  readonly stationLabels?: readonly string[];
}

const STATE_COLOR: Record<string, string> = {
  Running: "bg-sim-running text-sim-running-foreground",
  Starved: "bg-sim-starved text-sim-starved-foreground",
  BlockedOut: "bg-sim-blocked text-sim-blocked-foreground",
  Down: "bg-sim-down text-sim-down-foreground",
  Setup: "bg-sim-setup text-sim-setup-foreground",
  Maintenance: "bg-sim-maintenance text-sim-maintenance-foreground",
  Idle: "bg-sim-idle text-sim-idle-foreground",
};

function dominantState(stateMs: Readonly<Record<string, number>>): string | null {
  let best: string | null = null;
  let bestMs = 0;
  for (const [k, v] of Object.entries(stateMs)) {
    if (v > bestMs) {
      bestMs = v;
      best = k;
    }
  }
  return best;
}

export function FinalStateCard({ result, stationLabels }: FinalStateCardProps) {
  const last = result.samples[result.samples.length - 1];
  if (!last) {
    return (
      <p className="text-muted-foreground text-xs">
        No samples — enable <strong>Sample throughput over time</strong> in Run settings to
        populate.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="final-state-card">
      {last.perStationStateMs.map((stateMs, idx) => {
        const label =
          stationLabels?.[idx] ?? result.bottlenecks[idx]?.label ?? `Station ${String(idx)}`;
        const state = dominantState(stateMs);
        const colorClass = state ? (STATE_COLOR[state] ?? "bg-muted") : "bg-muted";
        return (
          <li key={`${label}-${String(idx)}`} className="flex items-center justify-between text-xs">
            <span className="truncate font-medium">{label}</span>
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${colorClass}`}>
              {state === "BlockedOut" ? "Blocked" : (state ?? "—")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
