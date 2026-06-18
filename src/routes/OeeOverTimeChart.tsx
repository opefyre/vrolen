/**
 * Stacked-area chart of a station's state-mix over time (VROL-620). Reads
 * VROL-619's perStationStateMs from each sample, derives within-interval
 * fractions by diffing consecutive samples, and stacks them bottom-to-top by
 * a fixed state order. Hand-rolled SVG — no chart library, same approach as
 * ThroughputChart (VROL-613) and Sparkline (VROL-614).
 */

import { useMemo, useRef, useState } from "react";

import type { TimeseriesSample } from "@/engine";

interface OeeOverTimeChartProps {
  readonly samples: readonly TimeseriesSample[];
  readonly stationLabels: readonly string[];
  readonly bottleneckStationIdx: number;
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
  stationLabels,
  bottleneckStationIdx,
  horizonMs,
  warmupMs,
}: OeeOverTimeChartProps) {
  // VROL-621 — local picker state, defaults to whatever the bottleneck is.
  // Re-syncs whenever a new run shifts the bottleneck. Pattern docs:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [stationIdx, setStationIdx] = useState<number>(bottleneckStationIdx);
  const [lastBottleneckSeen, setLastBottleneckSeen] = useState<number>(bottleneckStationIdx);
  if (lastBottleneckSeen !== bottleneckStationIdx) {
    setLastBottleneckSeen(bottleneckStationIdx);
    setStationIdx(bottleneckStationIdx);
  }
  const safeIdx = Math.min(Math.max(0, stationIdx), Math.max(0, stationLabels.length - 1));
  const stationLabel = stationLabels[safeIdx] ?? `Station ${String(safeIdx + 1)}`;

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
      const prev = samples[i - 1]?.perStationStateMs[safeIdx] ?? {};
      const curr = samples[i]?.perStationStateMs[safeIdx] ?? {};
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
  }, [samples, safeIdx, horizonMs, warmupMs]);

  // VROL-622 — derive the hovered sample's per-state fraction for the tooltip.
  const hoveredFractions = useMemo<{ state: string; pct: number }[]>(() => {
    if (hoverIdx === null || hoverIdx === 0) return [];
    const prev = samples[hoverIdx - 1]?.perStationStateMs[safeIdx] ?? {};
    const curr = samples[hoverIdx]?.perStationStateMs[safeIdx] ?? {};
    let total = 0;
    const deltas: Record<string, number> = {};
    for (const s of STATE_ORDER) {
      const d = Math.max(0, (curr[s] ?? 0) - (prev[s] ?? 0));
      deltas[s] = d;
      total += d;
    }
    if (total <= 0) return [];
    return STATE_ORDER.map((s) => ({ state: s, pct: ((deltas[s] ?? 0) / total) * 100 }));
  }, [hoverIdx, samples, safeIdx]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (samples.length === 0 || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const xRatio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const sampleX = (samples[i]?.tMs ?? 0) - warmupMs;
      const ratio = sampleX / Math.max(1, horizonMs - warmupMs);
      const dist = Math.abs(ratio - xRatio);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    setHoverIdx(best);
  };
  const onLeave = (): void => {
    setHoverIdx(null);
  };

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
      {stationLabels.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pick a station to chart">
          {stationLabels.map((label, i) => {
            const isSelected = i === safeIdx;
            const isBottleneck = i === bottleneckStationIdx;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => {
                  setStationIdx(i);
                }}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  isSelected
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
                title={isBottleneck ? "Bottleneck — the rate-limiting station" : undefined}
              >
                {label}
                {isBottleneck ? <span className="ml-1 opacity-70">·bn</span> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">
          Station: <strong className="text-foreground">{stationLabel}</strong>
        </p>
      )}
      <div ref={wrapperRef} className="relative w-full" onMouseMove={onMove} onMouseLeave={onLeave}>
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
          {/* VROL-622 — X-axis ticks at warmup / mid / horizon (matches the
              labels below) so the eye can place the hover position. */}
          {[0, 0.5, 1].map((frac) => {
            const x = PAD_X + (VIEW_W - PAD_X * 2) * frac;
            return (
              <line
                key={`x-${String(frac)}`}
                x1={x}
                y1={PAD_Y}
                x2={x}
                y2={VIEW_H - PAD_Y}
                stroke="currentColor"
                strokeOpacity={frac === 0 || frac === 1 ? 0.25 : 0.1}
                strokeDasharray="2 2"
              />
            );
          })}
          {hoverIdx !== null && samples[hoverIdx] ? (
            <line
              x1={
                PAD_X +
                ((VIEW_W - PAD_X * 2) * ((samples[hoverIdx]?.tMs ?? 0) - warmupMs)) /
                  Math.max(1, horizonMs - warmupMs)
              }
              y1={PAD_Y}
              x2={
                PAD_X +
                ((VIEW_W - PAD_X * 2) * ((samples[hoverIdx]?.tMs ?? 0) - warmupMs)) /
                  Math.max(1, horizonMs - warmupMs)
              }
              y2={VIEW_H - PAD_Y}
              stroke="currentColor"
              strokeOpacity={0.45}
              strokeDasharray="2 2"
            />
          ) : null}
        </svg>
        {hoverIdx !== null && hoveredFractions.length > 0 ? (
          <div className="bg-card/95 border-border absolute top-1 right-1 rounded-md border p-1.5 text-[10px] shadow-sm">
            <div className="text-muted-foreground mb-0.5 font-mono tabular-nums">
              t={((samples[hoverIdx]?.tMs ?? 0) / 1000).toFixed(1)}s
            </div>
            {hoveredFractions
              .filter((f) => f.pct > 0.5)
              .map(({ state, pct }) => (
                <div key={state} className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-2 w-2 rounded-sm ${STATE_FILL_CLASS[
                      state as (typeof STATE_ORDER)[number]
                    ].replace("fill-", "bg-")}`}
                  />
                  <span className="text-foreground">{state}</span>
                  <span className="font-mono tabular-nums">{pct.toFixed(0)}%</span>
                </div>
              ))}
          </div>
        ) : null}
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
        <span className="font-mono tabular-nums">
          {warmupMs > 0 ? `${(warmupMs / 1000).toFixed(1)}s` : "0s"}
        </span>
        <span className="font-mono tabular-nums">
          {((warmupMs + (horizonMs - warmupMs) / 2) / 1000).toFixed(1)}s
        </span>
        <span className="font-mono tabular-nums">{(horizonMs / 1000).toFixed(1)}s</span>
      </div>
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
