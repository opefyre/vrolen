/**
 * Stacked-area chart of a station's state-mix over time (VROL-620). Reads
 * VROL-619's perStationStateMs from each sample, derives within-interval
 * fractions by diffing consecutive samples, and stacks them bottom-to-top by
 * a fixed state order. Hand-rolled SVG — no chart library, same approach as
 * ThroughputChart (VROL-613) and Sparkline (VROL-614).
 */

import { useMemo } from "react";

import type { TimeseriesSample } from "@/engine";

interface OeeOverTimeChartProps {
  readonly samples: readonly TimeseriesSample[];
  readonly stationIdx: number;
  readonly stationLabel: string;
  readonly horizonMs: number;
  readonly warmupMs: number;
}

/**
 * Fixed bottom-to-top stack order. Putting Running at the BOTTOM means a
 * healthy run renders as a solid green base with thin colored strips on top —
 * matches the "OEE = how much you're running" intuition.
 */
const STATE_ORDER = [
  "Running",
  "Setup",
  "Idle",
  "BlockedOut",
  "Starved",
  "Maintenance",
  "Down",
] as const;

const STATE_FILL_CLASS: Record<(typeof STATE_ORDER)[number], string> = {
  Running: "fill-sim-running",
  Setup: "fill-sim-setup",
  Idle: "fill-sim-idle",
  BlockedOut: "fill-sim-blocked",
  Starved: "fill-sim-starved",
  Maintenance: "fill-sim-maintenance",
  Down: "fill-sim-down",
};

const VIEW_W = 240;
const VIEW_H = 80;
const PAD_X = 4;
const PAD_Y = 4;

export function OeeOverTimeChart({
  samples,
  stationIdx,
  stationLabel,
  horizonMs,
  warmupMs,
}: OeeOverTimeChartProps) {
  const paths = useMemo<{ state: string; d: string }[]>(() => {
    if (samples.length < 2) return [];
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const startMs = warmupMs;
    const spanMs = Math.max(1, horizonMs - startMs);
    const xOf = (tMs: number): number => PAD_X + ((tMs - startMs) / spanMs) * innerW;
    const yOf = (cumFraction: number): number => PAD_Y + innerH - cumFraction * innerH;

    // For each pair (i-1, i): derive the within-interval state fractions for
    // the picked station. Each state then accumulates a top-line and bottom-
    // line array (one entry per sample boundary, length = samples.length).
    const top: Record<string, number[]> = {};
    const bot: Record<string, number[]> = {};
    for (const s of STATE_ORDER) {
      top[s] = new Array<number>(samples.length).fill(0);
      bot[s] = new Array<number>(samples.length).fill(0);
    }
    // Walk samples; for i=0 there's no interval — leave its top/bot at 0
    // (they're only used as the starting point of segment i=1).
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1]?.perStationStateMs[stationIdx] ?? {};
      const curr = samples[i]?.perStationStateMs[stationIdx] ?? {};
      const deltas: Record<string, number> = {};
      let totalDelta = 0;
      for (const s of STATE_ORDER) {
        const d = Math.max(0, (curr[s] ?? 0) - (prev[s] ?? 0));
        deltas[s] = d;
        totalDelta += d;
      }
      let cum = 0;
      for (const s of STATE_ORDER) {
        const frac = totalDelta > 0 ? (deltas[s] ?? 0) / totalDelta : 0;
        const arrBot = bot[s];
        const arrTop = top[s];
        if (arrBot) arrBot[i] = cum;
        cum += frac;
        if (arrTop) arrTop[i] = cum;
      }
      // Sample 0 carries the same stacks as sample 1 for a clean leading edge.
      if (i === 1) {
        for (const s of STATE_ORDER) {
          const arrBot = bot[s];
          const arrTop = top[s];
          if (arrBot) arrBot[0] = arrBot[1] ?? 0;
          if (arrTop) arrTop[0] = arrTop[1] ?? 0;
        }
      }
    }

    // Build one path per state: forward along the top line, backward along
    // the bottom line, close.
    const out: { state: string; d: string }[] = [];
    for (const s of STATE_ORDER) {
      const topArr = top[s] ?? [];
      const botArr = bot[s] ?? [];
      let d = "";
      for (let i = 0; i < samples.length; i++) {
        const x = xOf(samples[i]?.tMs ?? 0);
        const y = yOf(topArr[i] ?? 0);
        d += `${i === 0 ? "M" : " L"} ${String(x.toFixed(2))} ${String(y.toFixed(2))}`;
      }
      for (let i = samples.length - 1; i >= 0; i--) {
        const x = xOf(samples[i]?.tMs ?? 0);
        const y = yOf(botArr[i] ?? 0);
        d += ` L ${String(x.toFixed(2))} ${String(y.toFixed(2))}`;
      }
      d += " Z";
      out.push({ state: s, d });
    }
    return out;
  }, [samples, stationIdx, horizonMs, warmupMs]);

  if (samples.length < 2) {
    return (
      <p className="text-muted-foreground text-xs">
        No samples yet. Enable <strong>Sample throughput over time</strong> in Run settings to draw
        a state-mix chart here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Bottleneck station: <strong className="text-foreground">{stationLabel}</strong>
      </p>
      <svg
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
        role="img"
        aria-label={`State-mix over time for ${stationLabel}`}
      >
        {paths.map(({ state, d }) => (
          <path
            key={state}
            d={d}
            className={STATE_FILL_CLASS[state as (typeof STATE_ORDER)[number]]}
          />
        ))}
      </svg>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        {STATE_ORDER.map((state) => (
          <span key={state} className="flex items-center gap-1">
            <span
              className={`inline-block h-2 w-2 rounded-sm ${STATE_FILL_CLASS[state].replace(
                "fill-",
                "bg-",
              )}`}
            />
            {state}
          </span>
        ))}
      </div>
    </div>
  );
}
