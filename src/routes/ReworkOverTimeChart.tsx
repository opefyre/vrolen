/**
 * Per-station rework cumulative-count chart (VROL-641).
 *
 * Consumes the per-tick perStationRework[] series instrumented in VROL-639.
 * Renders one line per station that had rework during the run; stations
 * with zero rework are filtered out so the chart stays uncluttered. When
 * no station has any rework, the parent should not render this — but as
 * a safety net we also return a muted hint instead of an empty SVG.
 */

import { useMemo, useState } from "react";

import type { TimeseriesSample } from "@/engine";
import { useChartDimensions } from "@/lib/use-chart-dimensions";

interface ReworkOverTimeChartProps {
  readonly samples: readonly TimeseriesSample[];
  readonly stationLabels: readonly string[];
  readonly horizonMs: number;
  readonly warmupMs: number;
  /**
   * Optional secondary series for scenario-comparison overlays (VROL-644).
   * When set, draws one muted dashed line per active station from the
   * secondary samples on the same X/Y scales. Pass the same stationLabels
   * for both series — the legend reuses them.
   */
  readonly secondarySamples?: readonly TimeseriesSample[];
  readonly primaryLabel?: string;
  readonly secondaryLabel?: string;
}

interface HoverState {
  readonly idx: number;
}

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
  secondarySamples,
  primaryLabel,
  secondaryLabel,
}: ReworkOverTimeChartProps) {
  const {
    containerRef: svgRef,
    width: measuredW,
    height: measuredH,
  } = useChartDimensions<SVGSVGElement>({ width: 240, height: 80 });
  const VIEW_W = Math.max(160, measuredW);
  const VIEW_H = Math.max(120, measuredH);
  const [hover, setHover] = useState<HoverState | null>(null);
  const { activeStations, paths, secondaryPaths, maxY, plotXFor, plotYFor } = useMemo(() => {
    const empty = {
      activeStations: [] as number[],
      paths: [] as string[],
      secondaryPaths: [] as string[],
      maxY: 0,
      plotXFor: () => 0,
      plotYFor: () => 0,
    };
    if (samples.length < 2) return empty;
    const last = samples[samples.length - 1]!.perStationRework;
    const active: number[] = [];
    for (let i = 0; i < last.length; i++) {
      if ((last[i] ?? 0) > 0) active.push(i);
    }
    if (active.length === 0) return empty;
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const startMs = warmupMs;
    const spanMs = Math.max(1, horizonMs - startMs);
    const peakAcross = (arr: readonly TimeseriesSample[]): number => {
      let p = 0;
      for (const s of arr) {
        for (const stn of active) {
          const v = s.perStationRework[stn] ?? 0;
          if (v > p) p = v;
        }
      }
      return p;
    };
    // Y-scale must accommodate both series so neither line clips.
    const peak = Math.max(peakAcross(samples), secondarySamples ? peakAcross(secondarySamples) : 0);
    const yScale = peak > 0 ? innerH / peak : 0;
    const xOf = (tMs: number): number => PAD_X + ((tMs - startMs) / spanMs) * innerW;
    const yOf = (n: number): number => PAD_Y + innerH - n * yScale;
    const buildLines = (arr: readonly TimeseriesSample[]): string[] =>
      active.map((stn) => {
        let d = "";
        arr.forEach((s, i) => {
          const v = s.perStationRework[stn] ?? 0;
          d += `${i === 0 ? "M" : " L"} ${String(xOf(s.tMs))} ${String(yOf(v))}`;
        });
        return d;
      });
    return {
      activeStations: active,
      paths: buildLines(samples),
      secondaryPaths: secondarySamples ? buildLines(secondarySamples) : [],
      maxY: peak,
      plotXFor: xOf,
      plotYFor: yOf,
    };
  }, [samples, secondarySamples, horizonMs, warmupMs, VIEW_W, VIEW_H]);

  // VROL-807 — keyboard nav. ArrowLeft / ArrowRight steps through samples.
  const setHoverByIdx = (idx: number): void => {
    if (samples.length === 0) return;
    const clamped = Math.max(0, Math.min(samples.length - 1, idx));
    setHover({ idx: clamped });
  };
  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>): void => {
    if (samples.length === 0) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const last = samples.length - 1;
    const current = hover ? hover.idx : last;
    const delta = e.key === "ArrowRight" ? 1 : -1;
    setHoverByIdx(current + delta);
  };
  const onFocus = (): void => {
    if (hover === null && samples.length > 0) {
      setHoverByIdx(samples.length - 1);
    }
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (samples.length === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const hasBounds = rect.width > 0 && rect.height > 0;
    const xRatio = hasBounds ? VIEW_W / rect.width : 1;
    const xInView = hasBounds ? (e.clientX - rect.left) * xRatio : e.clientX;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dx = Math.abs(plotXFor(samples[i]?.tMs ?? 0) - xInView);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    // Multi-line chart: only show hover when cursor is close to the
    // nearest active station's line. Skipped when bounds are 0 (test env).
    if (hasBounds) {
      const yRatio = VIEW_H / rect.height;
      const yInView = (e.clientY - rect.top) * yRatio;
      const HOVER_TOL_VIEW_UNITS = VIEW_H * 0.25;
      let nearestLineDist = Infinity;
      const sample = samples[best];
      if (sample) {
        for (const stn of activeStations) {
          const v = sample.perStationRework?.[stn] ?? 0;
          const d = Math.abs(yInView - plotYFor(v));
          if (d < nearestLineDist) nearestLineDist = d;
        }
      }
      if (nearestLineDist > HOVER_TOL_VIEW_UNITS) {
        if (hover !== null) setHover(null);
        return;
      }
    }
    setHover({ idx: best });
  };
  const onLeave = (): void => {
    setHover(null);
  };
  const hovered = hover && samples[hover.idx] ? samples[hover.idx] : null;

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
    <div className="relative w-full">
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
        {secondaryPaths.length > 0 ? (
          <span className="text-muted-foreground ml-2 flex items-center gap-1.5">
            <span
              className="inline-block h-[2px] w-4 rounded-full"
              style={{
                background:
                  "repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 5px)",
              }}
            />
            <span className="text-foreground">
              {primaryLabel ?? "A"} vs <em>{secondaryLabel ?? "B"}</em>
            </span>
          </span>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        className="focus-visible:ring-ring block h-44 w-full focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        role="img"
        tabIndex={0}
        aria-label={(() => {
          // VROL-807 — summarise the chart so screen readers don't read every
          // path. Includes peak + active-station count so the reader knows
          // what they're stepping through with arrow keys.
          const horizonSec = Math.round(horizonMs / 1000);
          return `Rework over time: ${String(activeStations.length)} station${activeStations.length === 1 ? "" : "s"} with rework, peak ${String(maxY.toLocaleString())} cumulative rework parts across ${String(horizonSec)} seconds. Use arrow keys to step through samples.`;
        })()}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
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
        {secondaryPaths.map((d, i) => {
          const colorClass = STATION_COLORS[i % STATION_COLORS.length] ?? STATION_COLORS[0]!;
          return (
            <path
              key={`secondary-${String(i)}`}
              d={d}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.55}
              strokeDasharray="3 2"
              strokeWidth={1.5}
              className={colorClass}
            />
          );
        })}
        {hovered ? (
          <line
            x1={plotXFor(hovered.tMs)}
            y1={PAD_Y}
            x2={plotXFor(hovered.tMs)}
            y2={VIEW_H - PAD_Y}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeDasharray="2 2"
          />
        ) : null}
        {hovered
          ? activeStations.map((stn, i) => {
              const v = hovered.perStationRework[stn] ?? 0;
              const colorClass = STATION_COLORS[i % STATION_COLORS.length] ?? STATION_COLORS[0]!;
              return (
                <circle
                  key={`dot-${String(i)}`}
                  cx={plotXFor(hovered.tMs)}
                  cy={plotYFor(v)}
                  r={2.5}
                  fill="currentColor"
                  className={colorClass}
                />
              );
            })
          : null}
      </svg>
      {/* VROL-807 — live region for keyboard-driven sample navigation. */}
      <span className="sr-only" aria-live="polite">
        {hovered
          ? `Sample at ${(hovered.tMs / 1000).toFixed(1)} seconds: ${activeStations
              .map((stn) => {
                const label = stationLabels[stn] ?? `Station ${String(stn + 1)}`;
                const v = hovered.perStationRework[stn] ?? 0;
                return `${label} ${String(v)} cumulative rework`;
              })
              .join(", ")}.`
          : ""}
      </span>
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
        <span>
          {hovered ? (
            <span className="font-mono tabular-nums">
              t={(hovered.tMs / 1000).toFixed(1)}s ·{" "}
              {activeStations
                .map((stn) => {
                  const label = stationLabels[stn] ?? `S${String(stn + 1)}`;
                  const v = hovered.perStationRework[stn] ?? 0;
                  return `${label}: ${String(v)}`;
                })
                .join(" · ")}
            </span>
          ) : (
            <span>{maxY.toLocaleString()} cumulative rework parts</span>
          )}
        </span>
        <span className="font-mono tabular-nums">{maxY.toLocaleString()}</span>
      </div>
    </div>
  );
}
