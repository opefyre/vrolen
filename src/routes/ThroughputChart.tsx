/**
 * Hand-rolled SVG throughput-over-time chart (VROL-613).
 *
 * Fed by ChainResult.samples from VROL-612. Pure component — no chart library,
 * no refs, no animations — keeps the /editor bundle slim and lets us snapshot-
 * test the resulting path.
 *
 * Renders cumulative lineCompleted over tMs as a step area + outline plus a
 * lightweight cursor-tracked tooltip that shows the (tMs, lineCompleted) at
 * the hovered X.
 *
 * VROL-845 — second view: instantaneous parts-per-hour computed as a moving
 * window over the samples. The user toggles between Cumulative (default) and
 * Instantaneous rate via a segmented control above the chart.
 */

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { TimeseriesSample } from "@/engine";
import { computeInstantaneousRate, type RatePoint } from "@/lib/throughput-rate";
import { useChartDimensions } from "@/lib/use-chart-dimensions";

interface ThroughputChartProps {
  readonly samples: readonly TimeseriesSample[];
  readonly horizonMs: number;
  readonly warmupMs: number;
  /**
   * Optional second series for scenario comparison (VROL-624). When set,
   * renders a second line on the same X/Y scales in a muted color so the
   * curves overlay cleanly. Y-scale is the max of both series.
   */
  readonly secondarySamples?: readonly TimeseriesSample[];
  readonly primaryLabel?: string;
  readonly secondaryLabel?: string;
  /**
   * VROL-908 — when set, clip the rendered series to samples[0..playheadIdx]
   * so the chart fills in left-to-right as the playback scrubber moves.
   * null/undefined renders the full series (paused or no playback).
   */
  readonly playheadIdx?: number | null;
}

const PAD_X = 4;
const PAD_Y = 4;
// VROL-845 — 5s moving window for the instantaneous-rate view. Picked to
// match the sampler's default cadence so the curve has enough samples to
// smooth out engine jitter without flattening real throughput swings.
const RATE_WINDOW_MS = 5_000;

type ChartView = "cumulative" | "rate";

interface HoverState {
  readonly idx: number;
  readonly x: number;
}

export function ThroughputChart({
  samples: rawSamples,
  horizonMs,
  warmupMs,
  secondarySamples,
  primaryLabel,
  secondaryLabel,
  playheadIdx,
}: ThroughputChartProps) {
  // VROL-908 — clip the rendered series to samples[0..playheadIdx] so the
  // chart fills in left-to-right during playback. Memoised so paused
  // playback (playheadIdx unchanged across renders) doesn't re-slice.
  const samples = useMemo(
    () =>
      typeof playheadIdx === "number" && playheadIdx >= 0
        ? rawSamples.slice(0, playheadIdx + 1)
        : rawSamples,
    [rawSamples, playheadIdx],
  );
  // Track the SVG's actual pixel size so its viewBox matches 1:1 — no
  // stretching, no letterboxing, no aspect mismatch. The ref must point
  // at the SVG itself (not the wrapper div, which is taller because of
  // the legend + axis-label rows).
  const {
    containerRef: svgRef,
    width: measuredW,
    height: measuredH,
  } = useChartDimensions<SVGSVGElement>({ width: 240, height: 80 });
  const VIEW_W = Math.max(160, measuredW);
  const VIEW_H = Math.max(120, measuredH);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [view, setView] = useState<ChartView>("cumulative");

  // VROL-845 — derive the rate-mode series. Memoised so flipping back and
  // forth between views is free.
  const primaryRate = useMemo<readonly RatePoint[]>(
    () => computeInstantaneousRate(samples, RATE_WINDOW_MS, warmupMs),
    [samples, warmupMs],
  );
  const secondaryRate = useMemo<readonly RatePoint[]>(
    () =>
      secondarySamples ? computeInstantaneousRate(secondarySamples, RATE_WINDOW_MS, warmupMs) : [],
    [secondarySamples, warmupMs],
  );

  const { areaPath, linePath, secondaryLinePath, maxY, plotXFor, plotYFor } = useMemo(() => {
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const startMs = warmupMs;
    const spanMs = Math.max(1, horizonMs - startMs);
    const xOf = (tMs: number): number => PAD_X + ((tMs - startMs) / spanMs) * innerW;
    if (view === "cumulative") {
      const peak = (arr: readonly TimeseriesSample[]): number =>
        arr.reduce((m, s) => Math.max(m, s.lineCompleted), 0);
      // VROL-624 — Y-scale uses the max of BOTH series so neither line clips.
      const maxCompleted = Math.max(peak(samples), secondarySamples ? peak(secondarySamples) : 0);
      const yScale = maxCompleted > 0 ? innerH / maxCompleted : 0;
      const yOf = (n: number): number => PAD_Y + innerH - n * yScale;
      if (samples.length === 0) {
        return {
          areaPath: "",
          linePath: "",
          secondaryLinePath: "",
          maxY: 0,
          plotXFor: xOf,
          plotYFor: yOf,
        };
      }
      const buildLine = (arr: readonly TimeseriesSample[]): string => {
        let d = "";
        arr.forEach((s, i) => {
          d += `${i === 0 ? "" : " "}${i === 0 ? "M" : "L"} ${String(xOf(s.tMs))} ${String(yOf(s.lineCompleted))}`;
        });
        return d;
      };
      const line = buildLine(samples);
      let area = `M ${String(xOf(samples[0]?.tMs ?? startMs))} ${String(PAD_Y + innerH)}`;
      samples.forEach((s) => {
        area += ` L ${String(xOf(s.tMs))} ${String(yOf(s.lineCompleted))}`;
      });
      const lastX = xOf(samples[samples.length - 1]?.tMs ?? horizonMs);
      area += ` L ${String(lastX)} ${String(PAD_Y + innerH)} Z`;
      const secondaryLine =
        secondarySamples && secondarySamples.length > 0 ? buildLine(secondarySamples) : "";
      return {
        areaPath: area,
        linePath: line,
        secondaryLinePath: secondaryLine,
        maxY: maxCompleted,
        plotXFor: xOf,
        plotYFor: yOf,
      };
    }
    // VROL-845 — instantaneous-rate view. Same X mapping as cumulative; Y is
    // parts/hour with scale = max(rate) across both series.
    const peakRate = (arr: readonly RatePoint[]): number =>
      arr.reduce((m, p) => Math.max(m, p.ratePerHour), 0);
    const maxRate = Math.max(peakRate(primaryRate), peakRate(secondaryRate));
    const yScale = maxRate > 0 ? innerH / maxRate : 0;
    const yOf = (n: number): number => PAD_Y + innerH - n * yScale;
    if (primaryRate.length === 0) {
      return {
        areaPath: "",
        linePath: "",
        secondaryLinePath: "",
        maxY: 0,
        plotXFor: xOf,
        plotYFor: yOf,
      };
    }
    const buildRateLine = (arr: readonly RatePoint[]): string => {
      let d = "";
      arr.forEach((p, i) => {
        d += `${i === 0 ? "" : " "}${i === 0 ? "M" : "L"} ${String(xOf(p.tMs))} ${String(yOf(p.ratePerHour))}`;
      });
      return d;
    };
    const line = buildRateLine(primaryRate);
    let area = `M ${String(xOf(primaryRate[0]?.tMs ?? startMs))} ${String(PAD_Y + innerH)}`;
    primaryRate.forEach((p) => {
      area += ` L ${String(xOf(p.tMs))} ${String(yOf(p.ratePerHour))}`;
    });
    const lastX = xOf(primaryRate[primaryRate.length - 1]?.tMs ?? horizonMs);
    area += ` L ${String(lastX)} ${String(PAD_Y + innerH)} Z`;
    const secondaryLine = secondaryRate.length > 0 ? buildRateLine(secondaryRate) : "";
    return {
      areaPath: area,
      linePath: line,
      secondaryLinePath: secondaryLine,
      maxY: maxRate,
      plotXFor: xOf,
      plotYFor: yOf,
    };
  }, [
    samples,
    secondarySamples,
    horizonMs,
    warmupMs,
    VIEW_W,
    VIEW_H,
    view,
    primaryRate,
    secondaryRate,
  ]);

  // VROL-845 — hover indexes the active series so the tooltip works in both
  // modes. In rate view, hover.idx points into primaryRate; in cumulative, into samples.
  const hoverSeriesLength = view === "cumulative" ? samples.length : primaryRate.length;
  const hoverXAtIdx = (i: number): number => {
    if (view === "cumulative") return plotXFor(samples[i]?.tMs ?? 0);
    return plotXFor(primaryRate[i]?.tMs ?? 0);
  };
  const hoverYAtIdx = (i: number): number => {
    if (view === "cumulative") return plotYFor(samples[i]?.lineCompleted ?? 0);
    return plotYFor(primaryRate[i]?.ratePerHour ?? 0);
  };

  // VROL-807 — keyboard-driven hover. Tab into the SVG then ArrowLeft /
  // ArrowRight to step through samples; the existing tooltip + live region
  // narrate the active value.
  const setHoverByIdx = (idx: number): void => {
    if (hoverSeriesLength === 0) return;
    const clamped = Math.max(0, Math.min(hoverSeriesLength - 1, idx));
    const x = hoverXAtIdx(clamped);
    // x is in view units; the tooltip overlay scales viewBox → pixel via
    // the chart wrapper's flex sizing. We pass the view-unit X through
    // because the tooltip absolute-positions off the SVG itself.
    setHover({ idx: clamped, x });
  };

  const onKeyDown = (e: React.KeyboardEvent<SVGSVGElement>): void => {
    if (hoverSeriesLength === 0) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const last = hoverSeriesLength - 1;
    const current = hover ? hover.idx : last;
    const delta = e.key === "ArrowRight" ? 1 : -1;
    setHoverByIdx(current + delta);
  };
  const onFocus = (): void => {
    if (hover === null && hoverSeriesLength > 0) {
      setHoverByIdx(hoverSeriesLength - 1);
    }
  };

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (hoverSeriesLength === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const hasBounds = rect.width > 0 && rect.height > 0;
    const xRatio = hasBounds ? VIEW_W / rect.width : 1;
    const xInView = hasBounds ? (e.clientX - rect.left) * xRatio : e.clientX;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < hoverSeriesLength; i++) {
      const dx = Math.abs(hoverXAtIdx(i) - xInView);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    // Only show the tooltip when the cursor is reasonably close to the
    // curve at that X. Hovering the empty space above/below counts as
    // "outside the chart" — clear the hover. Skip when we have no layout
    // (e.g. happy-dom in tests) so the legacy mouseMove assertions hold.
    if (hasBounds) {
      const yRatio = VIEW_H / rect.height;
      const yInView = (e.clientY - rect.top) * yRatio;
      const curveYAtCursor = hoverYAtIdx(best);
      const HOVER_TOL_VIEW_UNITS = VIEW_H * 0.25;
      if (Math.abs(yInView - curveYAtCursor) > HOVER_TOL_VIEW_UNITS) {
        if (hover !== null) setHover(null);
        return;
      }
    }
    const xPx = hasBounds ? (hoverXAtIdx(best) / VIEW_W) * rect.width : 0;
    setHover({ idx: best, x: xPx });
  };
  const onLeave = (): void => {
    setHover(null);
  };

  const hoveredSample =
    view === "cumulative" && hover && samples[hover.idx] ? samples[hover.idx] : null;
  const hoveredRate =
    view === "rate" && hover && primaryRate[hover.idx] ? primaryRate[hover.idx] : null;

  if (samples.length < 2) {
    return (
      <p className="text-muted-foreground text-xs">
        No samples yet. Enable <strong>Sample throughput over time</strong> in Run settings to draw
        a chart here.
      </p>
    );
  }

  return (
    <div className="relative w-full">
      {/* VROL-845 — segmented control to switch between cumulative parts
          and instantaneous parts/hour. Uses aria-pressed buttons grouped
          under a role="group" so screen readers announce it as a toolbar. */}
      <div
        role="group"
        aria-label="Chart view"
        className="border-border mb-2 inline-flex items-center gap-0.5 rounded-md border p-0.5"
      >
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={view === "cumulative"}
          onClick={() => {
            setView("cumulative");
            setHover(null);
          }}
          className={view === "cumulative" ? "bg-muted text-foreground" : "text-muted-foreground"}
        >
          Cumulative
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={view === "rate"}
          onClick={() => {
            setView("rate");
            setHover(null);
          }}
          className={view === "rate" ? "bg-muted text-foreground" : "text-muted-foreground"}
        >
          Instantaneous rate (parts/h)
        </Button>
      </div>
      {/* VROL-680 — always-on legend: line color + warmup shading. */}
      <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-sim-running inline-block h-0.5 w-4 rounded-full" />
          <span className="text-foreground">
            {secondaryLinePath
              ? (primaryLabel ?? "A")
              : view === "cumulative"
                ? "Completed parts"
                : "Throughput rate"}
          </span>
        </span>
        {secondaryLinePath ? (
          <span className="flex items-center gap-1.5">
            <span
              className="bg-sim-setup inline-block h-[2px] w-4 rounded-full"
              style={{
                background:
                  "repeating-linear-gradient(90deg, currentColor 0 3px, transparent 3px 5px)",
              }}
            />
            <span className="text-foreground">{secondaryLabel ?? "B"}</span>
          </span>
        ) : null}
        {warmupMs > 0 ? (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="bg-muted inline-block h-2 w-3 rounded-sm opacity-60" />
            <span>warmup excluded</span>
          </span>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        className="focus-visible:ring-ring text-sim-running block h-44 w-full focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        role="img"
        tabIndex={0}
        aria-label={(() => {
          // VROL-807 — concise chart summary so screen readers don't try
          // to read every path/circle. Includes peak so the user has a
          // sense of scale before stepping through with arrow keys.
          const peak = view === "cumulative" ? maxY : Math.round(maxY);
          const peakUnit = view === "cumulative" ? "parts" : "parts per hour";
          const horizonSec = Math.round(horizonMs / 1000);
          const last = samples.at(-1);
          const totalParts = last ? last.lineCompleted : 0;
          return `Throughput over time, ${view === "cumulative" ? "cumulative" : "instantaneous rate"} view: ${String(totalParts.toLocaleString())} parts completed across ${String(horizonSec)} seconds, peak ${String(peak.toLocaleString())} ${peakUnit}. Use arrow keys to step through samples.`;
        })()}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        {/* VROL-622 — Y-axis gridlines at 0, max/2, max. Label-less inside
            the SVG; the bottom row carries the numbers. */}
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
        {/* X-axis gridlines at warmup, mid, horizon (the bottom row labels
            map to the same fractions). */}
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
        <path
          d={areaPath}
          fill="currentColor"
          // VROL-845 — half the cumulative opacity in rate view since the
          // area is no longer "stuff that accumulated" but a rate envelope.
          fillOpacity={view === "cumulative" ? 0.18 : 0.09}
          stroke="none"
        />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} />
        {/* VROL-624 — secondary series for compare overlay. Muted color +
            dashed so it's visually distinguishable from the primary line. */}
        {secondaryLinePath ? (
          <path
            d={secondaryLinePath}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.55}
            strokeDasharray="3 2"
            strokeWidth={1.5}
            className="text-sim-setup"
          />
        ) : null}
        {hoveredSample ? (
          <line
            x1={plotXFor(hoveredSample.tMs)}
            y1={PAD_Y}
            x2={plotXFor(hoveredSample.tMs)}
            y2={VIEW_H - PAD_Y}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeDasharray="2 2"
          />
        ) : null}
        {hoveredSample ? (
          <circle
            cx={plotXFor(hoveredSample.tMs)}
            cy={plotYFor(hoveredSample.lineCompleted)}
            r={2.5}
            fill="currentColor"
          />
        ) : null}
        {hoveredRate ? (
          <line
            x1={plotXFor(hoveredRate.tMs)}
            y1={PAD_Y}
            x2={plotXFor(hoveredRate.tMs)}
            y2={VIEW_H - PAD_Y}
            stroke="currentColor"
            strokeOpacity={0.35}
            strokeDasharray="2 2"
          />
        ) : null}
        {hoveredRate ? (
          <circle
            cx={plotXFor(hoveredRate.tMs)}
            cy={plotYFor(hoveredRate.ratePerHour)}
            r={2.5}
            fill="currentColor"
          />
        ) : null}
      </svg>
      {/* VROL-807 — visually-hidden live region. Mirrors the visible
          tooltip so keyboard-only / screen-reader users hear the active
          sample as it changes from ArrowLeft/ArrowRight. */}
      <span className="sr-only" aria-live="polite">
        {hoveredSample
          ? `Sample at ${(hoveredSample.tMs / 1000).toFixed(1)} seconds: ${hoveredSample.lineCompleted.toLocaleString()} parts completed.`
          : hoveredRate
            ? `Sample at ${(hoveredRate.tMs / 1000).toFixed(1)} seconds: ${Math.round(hoveredRate.ratePerHour).toLocaleString()} parts per hour.`
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
      {/* VROL-680 — explicit axis labels so the reader knows what each axis means. */}
      <div className="text-muted-foreground mt-0.5 flex items-center justify-between text-[10px]">
        <span>time (s)</span>
        <span>{view === "cumulative" ? "parts" : "parts / hour"}</span>
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span className="font-mono tabular-nums">0</span>
        <span>
          {hoveredSample ? (
            <span className="font-mono tabular-nums">
              t={(hoveredSample.tMs / 1000).toFixed(1)}s ·{" "}
              {hoveredSample.lineCompleted.toLocaleString()} parts
              {/* VROL-716 — instantaneous rate at this hover point. */}
              {(() => {
                if (!hover || hover.idx === 0) return null;
                const prev = samples[hover.idx - 1];
                if (!prev) return null;
                const dt = hoveredSample.tMs - prev.tMs;
                if (dt <= 0) return null;
                const dParts = hoveredSample.lineCompleted - prev.lineCompleted;
                const ratePerHr = Math.round((dParts / dt) * 3_600_000);
                return ` · ${ratePerHr.toLocaleString()}/h`;
              })()}
            </span>
          ) : hoveredRate ? (
            <span className="font-mono tabular-nums">
              t={(hoveredRate.tMs / 1000).toFixed(1)}s ·{" "}
              {Math.round(hoveredRate.ratePerHour).toLocaleString()} parts/h
            </span>
          ) : view === "cumulative" ? (
            <span>{maxY.toLocaleString()} parts at horizon</span>
          ) : (
            <span>peak {Math.round(maxY).toLocaleString()} parts/h</span>
          )}
        </span>
        <span className="font-mono tabular-nums">
          {view === "cumulative" ? maxY.toLocaleString() : Math.round(maxY).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
