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

import { useMemo, useRef, useState } from "react";

import type { TimeseriesSample } from "@/engine";

interface ThroughputChartProps {
  readonly samples: readonly TimeseriesSample[];
  readonly horizonMs: number;
  readonly warmupMs: number;
}

const VIEW_W = 240;
const VIEW_H = 80;
const PAD_X = 4;
const PAD_Y = 4;

interface HoverState {
  readonly idx: number;
  readonly x: number;
}

export function ThroughputChart({ samples, horizonMs, warmupMs }: ThroughputChartProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const { areaPath, linePath, maxY, plotXFor, plotYFor } = useMemo(() => {
    const innerW = VIEW_W - PAD_X * 2;
    const innerH = VIEW_H - PAD_Y * 2;
    const startMs = warmupMs;
    const spanMs = Math.max(1, horizonMs - startMs);
    const maxCompleted = samples.reduce((m, s) => Math.max(m, s.lineCompleted), 0);
    const yScale = maxCompleted > 0 ? innerH / maxCompleted : 0;
    const xOf = (tMs: number): number => PAD_X + ((tMs - startMs) / spanMs) * innerW;
    const yOf = (n: number): number => PAD_Y + innerH - n * yScale;
    if (samples.length === 0) {
      return {
        areaPath: "",
        linePath: "",
        maxY: 0,
        plotXFor: xOf,
        plotYFor: yOf,
      };
    }
    let line = "";
    let area = `M ${String(xOf(samples[0]?.tMs ?? startMs))} ${String(PAD_Y + innerH)}`;
    samples.forEach((s, i) => {
      const x = xOf(s.tMs);
      const y = yOf(s.lineCompleted);
      const cmd = i === 0 ? "M" : "L";
      line += `${i === 0 ? "" : " "}${cmd} ${String(x)} ${String(y)}`;
      area += ` L ${String(x)} ${String(y)}`;
    });
    const lastX = xOf(samples[samples.length - 1]?.tMs ?? horizonMs);
    area += ` L ${String(lastX)} ${String(PAD_Y + innerH)} Z`;
    return {
      areaPath: area,
      linePath: line,
      maxY: maxCompleted,
      plotXFor: xOf,
      plotYFor: yOf,
    };
  }, [samples, horizonMs, warmupMs]);

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
      <svg
        viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
        preserveAspectRatio="none"
        className="text-sim-running h-20 w-full"
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <path d={areaPath} fill="currentColor" fillOpacity={0.18} stroke="none" />
        <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} />
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
      <div className="text-muted-foreground mt-1 flex items-center justify-between text-xs">
        <span className="font-mono tabular-nums">
          {warmupMs > 0 ? `${(warmupMs / 1000).toFixed(1)}s` : "0s"}
        </span>
        <span>
          {hovered ? (
            <span className="font-mono tabular-nums">
              t={(hovered.tMs / 1000).toFixed(1)}s · {hovered.lineCompleted.toLocaleString()} parts
            </span>
          ) : (
            <span>{maxY.toLocaleString()} parts at horizon</span>
          )}
        </span>
        <span className="font-mono tabular-nums">{(horizonMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}
