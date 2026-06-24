/**
 * VROL-977 — station-state Gantt across the run horizon. One row per
 * station; horizontal bands colored by dominant state per sampler
 * interval. Auto-hides when no sampler ran.
 *
 * Implementation note: the engine emits cumulative ms-in-state per
 * sample (perStationStateMs), so per-interval dominant state is the
 * argmax of the delta between consecutive samples. Cheap.
 */

import type { ChainResult } from "@/engine";
import type { StationState } from "@/engine/state-machine";

interface Props {
  readonly result: ChainResult;
}

const STATE_ORDER: readonly StationState[] = [
  "Running",
  "Starved",
  "BlockedOut",
  "Down",
  "Maintenance",
  "Setup",
  "Idle",
];

const STATE_COLOR: Record<StationState, string> = {
  Running: "var(--sim-running, oklch(0.7 0.18 145))",
  Starved: "var(--sim-starved, oklch(0.7 0.18 80))",
  BlockedOut: "var(--sim-blocked-out, oklch(0.6 0.16 35))",
  Down: "var(--sim-down, oklch(0.55 0.2 25))",
  Maintenance: "var(--sim-maintenance, oklch(0.55 0.12 260))",
  Setup: "var(--sim-setup, oklch(0.65 0.18 60))",
  Idle: "var(--sim-idle, oklch(0.7 0.04 270))",
};

const ROW_H = 14;
const ROW_GAP = 2;
const LABEL_W = 96;

export function StationGantt({ result }: Props) {
  const samples = result.samples ?? [];
  if (samples.length < 2) return null;
  const labels = result.perStationLabels ?? [];
  const stations = labels.length || samples[0]?.perStationStateMs.length || 0;
  if (stations === 0) return null;
  const tStart = samples[0]!.tMs;
  const tEnd = samples[samples.length - 1]!.tMs;
  const span = Math.max(1, tEnd - tStart);
  const W = 480;
  const drawW = W - LABEL_W;
  const H = stations * (ROW_H + ROW_GAP);
  return (
    <div
      className="border-border bg-card space-y-2 rounded-md border p-3"
      data-testid="station-gantt"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-foreground text-sm font-medium">Station-state Gantt</h3>
        <span className="text-muted-foreground text-[10px]">
          {(span / 1000).toFixed(1)}s window
        </span>
      </div>
      <p className="text-muted-foreground text-[11px] leading-snug">
        Per-station state over time. Each colored band is one sampler interval; the band's color
        reflects the dominant state in that interval.
      </p>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        width={W}
        height={H}
        role="img"
        aria-label="station state Gantt"
      >
        {Array.from({ length: stations }).map((_, sIdx) => {
          const yRow = sIdx * (ROW_H + ROW_GAP);
          return (
            <g key={sIdx}>
              <text
                x={LABEL_W - 4}
                y={yRow + ROW_H - 3}
                fontSize={9}
                textAnchor="end"
                fill="currentColor"
                className="text-foreground/80"
              >
                {labels[sIdx] ?? `Station ${String(sIdx)}`}
              </text>
              {samples.slice(1).map((cur, k) => {
                const prev = samples[k]!;
                const dt = cur.tMs - prev.tMs;
                if (dt <= 0) return null;
                const prevState = prev.perStationStateMs[sIdx] ?? {};
                const curState = cur.perStationStateMs[sIdx] ?? {};
                let bestState: StationState = "Idle";
                let bestDelta = -1;
                for (const st of STATE_ORDER) {
                  const delta = (curState[st] ?? 0) - (prevState[st] ?? 0);
                  if (delta > bestDelta) {
                    bestDelta = delta;
                    bestState = st;
                  }
                }
                const x = LABEL_W + ((prev.tMs - tStart) / span) * drawW;
                const w = (dt / span) * drawW;
                return (
                  <rect
                    key={k}
                    x={x}
                    y={yRow}
                    width={Math.max(0.5, w)}
                    height={ROW_H}
                    fill={STATE_COLOR[bestState]}
                  >
                    <title>{`${labels[sIdx] ?? "Station"}: ${bestState} • ${(prev.tMs / 1000).toFixed(1)}s–${(cur.tMs / 1000).toFixed(1)}s`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {STATE_ORDER.map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-sm" style={{ backgroundColor: STATE_COLOR[s] }} />
            <span className="text-muted-foreground text-[10px]">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
