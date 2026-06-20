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
 */

import { useMemo, useState } from "react";

import type { TimeseriesSample } from "@/engine";
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
}

const PAD_X = 4;
const PAD_Y = 4;

interface HoverState {
  readonly idx: number;
  readonly x: number;
}

export function ThroughputChart({
  samples,
  horizonMs,
  warmupMs,
  secondarySamples,
  primaryLabel,
  secondaryLabel,
}: ThroughputChartProps) {
  // Track real container size so the SVG viewBox matches the rendered
  // pixels 1:1 — no stretching or letterboxing.
  const {
    containerRef: wrapperRef,
    width: measuredW,
    height: measuredH,
  } = useChartDimensions<HTMLDivElement>({ width: 240, height: 80 });
  const VIEW_W = Math.max(160, measuredW);
  const VIEW_H = Math.max(120, measuredH);
  const [hover, setHover] = useState<HoverState | null>(null);

  const { areaPath, linePath, secondaryLinePath, maxY, plotXFor, plotYFor } = useMemo(() => {
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const startMs = warmupMs;
    const spanMs = Math.max(1, horizonMs - startMs);
    const peak = (arr: readonly TimeseriesSample[]): number =>
      arr.reduce((m, s) => Math.max(m, s.lineCompleted), 0);
    // VROL-624 — Y-scale uses the max of BOTH series so neither line clips.
    const maxCompleted = Math.max(peak(samples), secondarySamples ? peak(secondarySamples) : 0);
    const yScale = maxCompleted > 0 ? innerH / maxCompleted : 0;
    const xOf = (tMs: number): number => PAD_X + ((tMs - startMs) / spanMs) * innerW;
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
  }, [samples, secondarySamples, horizonMs, warmupMs, VIEW_W, VIEW_H]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (samples.length === 0 || !wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const ratio = VIEW_W / rect.width;
    const xInView = (e.clientX - rect.left) * ratio;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const dx = Math.abs(plotXFor(samples[i]?.tMs ?? 0) - xInView);
      if (dx < bestDist) {
        bestDist = dx;
        best = i;
      }
    }
    setHover({ idx: best, x: (plotXFor(samples[best]?.tMs ?? 0) / VIEW_W) * rect.width });
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

  return (
    <div ref={wrapperRef} className="relative w-full">
      {/* VROL-680 — always-on legend: line color + warmup shading. */}
      <div className="text-muted-foreground mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
        <span className="flex items-center gap-1.5">
          <span className="bg-sim-running inline-block h-0.5 w-4 rounded-full" />
          <span className="text-foreground">
            {secondaryLinePath ? (primaryLabel ?? "A") : "Completed parts"}
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
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        className="text-sim-running block h-44 w-full"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
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
        <path d={areaPath} fill="currentColor" fillOpacity={0.18} stroke="none" />
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
        {hovered ? (
          <circle
            cx={plotXFor(hovered.tMs)}
            cy={plotYFor(hovered.lineCompleted)}
            r={2.5}
            fill="currentColor"
          />
        ) : null}
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
      {/* VROL-680 — explicit axis labels so the reader knows what each axis means. */}
      <div className="text-muted-foreground mt-0.5 flex items-center justify-between text-[10px]">
        <span>time (s)</span>
        <span>parts</span>
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span className="font-mono tabular-nums">0</span>
        <span>
          {hovered ? (
            <span className="font-mono tabular-nums">
              t={(hovered.tMs / 1000).toFixed(1)}s · {hovered.lineCompleted.toLocaleString()} parts
              {/* VROL-716 — instantaneous rate at this hover point. */}
              {(() => {
                if (!hover || hover.idx === 0) return null;
                const prev = samples[hover.idx - 1];
                if (!prev) return null;
                const dt = hovered.tMs - prev.tMs;
                if (dt <= 0) return null;
                const dParts = hovered.lineCompleted - prev.lineCompleted;
                const ratePerHr = Math.round((dParts / dt) * 3_600_000);
                return ` · ${ratePerHr.toLocaleString()}/h`;
              })()}
            </span>
          ) : (
            <span>{maxY.toLocaleString()} parts at horizon</span>
          )}
        </span>
        <span className="font-mono tabular-nums">{maxY.toLocaleString()}</span>
      </div>
    </div>
  );
}
