/**
 * VROL-893 — per-station state-mix bar shown on each StationNode.
 *
 * The old per-station node sparkline was the cumulative-completed series for
 * that station. In steady state every station ships parts at the bottleneck
 * rate, so the sparkline looked identical on every card and conveyed no
 * per-station signal. This component replaces it with a stacked horizontal
 * bar of the time-weighted state mix (Running / Starved / Blocked / Setup /
 * Down / Maintenance / Idle), which is what actually differs between stations.
 *
 * Mirrors the colour palette used in the Per-station state breakdown card in
 * the result panel so legend + canvas stay in lockstep.
 */

import type { CSSProperties } from "react";

export interface StateMixSegment {
  readonly state: string;
  readonly pct: number;
}

interface StateMixBarProps {
  readonly breakdown: ReadonlyArray<StateMixSegment>;
  readonly width?: number;
  readonly height?: number;
}

function stateColor(state: string): string {
  switch (state) {
    case "Running":
      return "bg-sim-running";
    case "Starved":
      return "bg-sim-starved";
    case "BlockedOut":
      return "bg-sim-blocked";
    case "Down":
      return "bg-sim-down";
    case "Setup":
      return "bg-sim-setup";
    case "Maintenance":
      return "bg-sim-maintenance";
    case "Idle":
    default:
      return "bg-sim-idle";
  }
}

function stateLabel(state: string): string {
  return state === "BlockedOut" ? "Blocked" : state;
}

export function StateMixBar({ breakdown, width = 76, height = 10 }: StateMixBarProps) {
  const segments = breakdown.filter((s) => s.pct > 0.001);
  if (segments.length === 0) return null;
  const dominant = segments.reduce((a, b) => (b.pct > a.pct ? b : a));
  const summary = segments
    .map((s) => `${stateLabel(s.state)} ${Math.round(s.pct * 100)}%`)
    .join(" · ");
  const style: CSSProperties = { width, height };
  return (
    <div
      className="bg-muted flex overflow-hidden rounded-sm"
      style={style}
      role="img"
      aria-label={`State mix: ${summary}. Dominant: ${stateLabel(dominant.state)}.`}
      title={summary}
    >
      {segments.map((seg) => (
        <div
          key={seg.state}
          className={`h-full ${stateColor(seg.state)}`}
          style={{ width: `${String(seg.pct * 100)}%` }}
        />
      ))}
    </div>
  );
}
