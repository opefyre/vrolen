/**
 * Per-station rework cumulative-count chart (VROL-641).
 *
 * Consumes the per-tick perStationRework[] series instrumented in VROL-639.
 * Renders one line per station that had rework during the run; stations
 * with zero rework are filtered out so the chart stays uncluttered. When
 * no station has any rework, the parent should not render this — but as
 * a safety net we also return a muted hint instead of an empty SVG.
 */

import { useMemo } from "react";

import type { TimeseriesSample } from "@/engine";

interface ReworkOverTimeChartProps {
  readonly samples: readonly TimeseriesSample[];
  readonly stationLabels: readonly string[];
  readonly horizonMs: number;
  readonly warmupMs: number;
}

const VIEW_W = 240;
const VIEW_H = 80;
const PAD_X = 4;
const PAD_Y = 4;

// Five distinct hues from the sim-* token palette; cycled when more
// stations need a color.
const STATION_COLORS = [
  "text-sim-running",
  "text-sim-setup",
  "text-sim-blocked",
  "text-sim-down",
  "text-sim-maintenance",
] as const;

export function ReworkOverTimeChart({
  samples,
  stationLabels,
  horizonMs,
  warmupMs,
}: ReworkOverTimeChartProps) {
  const { activeStations, paths, maxY } = useMemo(() => {
    if (samples.length < 2) {
      return { activeStations: [] as number[], paths: [] as string[], maxY: 0 };
    }
    const last = samples[samples.length - 1]!.perStationRework;
    const active: number[] = [];
    for (let i = 0; i < last.length; i++) {
      if ((last[i] ?? 0) > 0) active.push(i);
    }
    if (active.length === 0) {
      return { activeStations: active, paths: [] as string[], maxY: 0 };
    }
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const startMs = warmupMs;
    const spanMs = Math.max(1, horizonMs - startMs);
    let peak = 0;
    for (const s of samples) {
      for (const stn of active) {
        const v = s.perStationRework[stn] ?? 0;
        if (v > peak) peak = v;
      }
    }
    const yScale = peak > 0 ? innerH / peak : 0;
    const xOf = (tMs: number): number => PAD_X + ((tMs - startMs) / spanMs) * innerW;
    const yOf = (n: number): number => PAD_Y + innerH - n * yScale;
    const built = active.map((stn) => {
      let d = "";
      samples.forEach((s, i) => {
        const v = s.perStationRework[stn] ?? 0;
        d += `${i === 0 ? "M" : " L"} ${String(xOf(s.tMs))} ${String(yOf(v))}`;
      });
      return d;
    });
    return { activeStations: active, paths: built, maxY: peak };
  }, [samples, horizonMs, warmupMs]);

  if (samples.length < 2) {
    return (
      <p className="text-muted-foreground text-xs">
        No samples yet. Enable <strong>Sample throughput over time</strong> in Run settings to draw
        a chart here.
      </p>
    );
  }
  if (activeStations.length === 0) {
    return <p className="text-muted-foreground text-xs">No rework recorded during this run.</p>;
  }

  return (
    <div className="w-full">
      <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        {activeStations.map((stn, i) => {
          const colorClass = STATION_COLORS[i % STATION_COLORS.length] ?? STATION_COLORS[0]!;
          const label = stationLabels[stn] ?? `Station ${String(stn + 1)}`;
          return (
            <span key={stn} className="flex items-center gap-1.5">
              <span className={`${colorClass} inline-block h-0.5 w-4 rounded-full bg-current`} />
              <span className="text-foreground">{label}</span>
            </span>
          );
        })}
      </div>
      <svg
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        className="h-20 w-full"
      >
        {[0, 0.5, 1].map((frac) => {
          const y = PAD_Y + (VIEW_H - PAD_Y * 2) * (1 - frac);
          return (
            <line
              key={`y-${String(frac)}`}
              x1={PAD_X}
              y1={y}
              x2={VIEW_W - PAD_X}
              y2={y}
              stroke="currentColor"
              strokeOpacity={frac === 0 ? 0.35 : 0.15}
              strokeDasharray={frac === 0 ? undefined : "2 2"}
            />
          );
        })}
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
        {paths.map((d, i) => {
          const colorClass = STATION_COLORS[i % STATION_COLORS.length] ?? STATION_COLORS[0]!;
          return (
            <path
              key={`line-${String(i)}`}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className={colorClass}
            />
          );
        })}
      </svg>
      <div className="text-muted-foreground mt-1 flex items-center justify-between text-[10px]">
        <span className="font-mono tabular-nums">
          {warmupMs > 0 ? `${(warmupMs / 1000).toFixed(1)}s` : "0s"}
        </span>
        <span className="font-mono tabular-nums">
          {((warmupMs + (horizonMs - warmupMs) / 2) / 1000).toFixed(1)}s
        </span>
        <span className="font-mono tabular-nums">{(horizonMs / 1000).toFixed(1)}s</span>
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span className="font-mono tabular-nums">0</span>
        <span>{maxY.toLocaleString()} cumulative rework parts</span>
        <span className="font-mono tabular-nums">{maxY.toLocaleString()}</span>
      </div>
    </div>
  );
}
