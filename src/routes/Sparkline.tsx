/**
 * Sparkline — area-filled line chart with peak/min markers + last-value
 * dot + hover tooltip. Stays compact enough for a 60×20 inline tile but
 * also scales well for the KPI-tile and accordion sizes.
 *
 * Renders nothing when there are fewer than two samples or when peak === 0.
 */

import { useMemo, useState } from "react";

interface SparklineProps {
  readonly series: readonly number[];
  readonly width?: number;
  readonly height?: number;
  /** Optional human label suffix used in the aria + tooltip ("parts"). */
  readonly unit?: string;
}

export function Sparkline({ series, width = 60, height = 20, unit = "" }: SparklineProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // VROL-807 — when focused, capture the previous keyboard-driven announcement
  // so it's exposed in an aria-live region tucked under the sparkline.
  const [focused, setFocused] = useState<boolean>(false);

  const geom = useMemo(() => {
    if (series.length < 2) return null;
    let peak = 0;
    let min = Infinity;
    let peakIdx = 0;
    let minIdx = 0;
    for (let i = 0; i < series.length; i++) {
      const v = series[i] ?? 0;
      if (v > peak) {
        peak = v;
        peakIdx = i;
      }
      if (v < min) {
        min = v;
        minIdx = i;
      }
    }
    if (peak <= 0) return null;
    const pad = 1.5;
    const yScale = (height - pad * 2) / Math.max(1, peak - 0);
    const xStep = (width - pad * 2) / (series.length - 1);
    const linePts: { x: number; y: number }[] = series.map((v, i) => ({
      x: pad + i * xStep,
      y: height - pad - v * yScale,
    }));
    const linePath = linePts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${String(p.x.toFixed(1))} ${String(p.y.toFixed(1))}`)
      .join(" ");
    const areaPath =
      linePts.length > 0
        ? `${linePath} L ${String(linePts.at(-1)!.x.toFixed(1))} ${String((height - pad).toFixed(1))} L ${String(linePts[0]!.x.toFixed(1))} ${String((height - pad).toFixed(1))} Z`
        : "";
    return { linePath, areaPath, linePts, peak, peakIdx, min, minIdx };
  }, [series, width, height]);

  if (!geom) return null;
  const last = geom.linePts.at(-1)!;
  const peakPt = geom.linePts[geom.peakIdx];
  const minPt = geom.linePts[geom.minIdx];
  const hoverPt = hoverIdx !== null ? geom.linePts[hoverIdx] : null;
  const hoverVal = hoverIdx !== null ? (series[hoverIdx] ?? 0) : 0;

  return (
    <span
      className="relative inline-block"
      style={{ width, height }}
      onMouseLeave={() => {
        setHoverIdx(null);
      }}
    >
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        className="focus-visible:ring-ring text-sim-running block focus-visible:rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        role="img"
        tabIndex={0}
        aria-label={
          hoverPt
            ? `Sparkline, sample ${String((hoverIdx ?? 0) + 1)} of ${String(series.length)}: ${hoverVal.toLocaleString()} ${unit}`.trim()
            : `Sparkline series with peak ${geom.peak.toLocaleString()} ${unit}, min ${geom.min.toLocaleString()} ${unit}, ${String(series.length)} samples`.trim()
        }
        onFocus={() => {
          setFocused(true);
          if (hoverIdx === null) setHoverIdx(geom.linePts.length - 1);
        }}
        onBlur={() => {
          setFocused(false);
          setHoverIdx(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const last = geom.linePts.length - 1;
          const current = hoverIdx ?? last;
          const delta = e.key === "ArrowRight" ? 1 : -1;
          const next = Math.max(0, Math.min(last, current + delta));
          setHoverIdx(next);
        }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = width / rect.width;
          const x = (e.clientX - rect.left) * ratio;
          // Snap to nearest sample.
          let best = 0;
          let bestDist = Infinity;
          for (let i = 0; i < geom.linePts.length; i++) {
            const dx = Math.abs((geom.linePts[i]?.x ?? 0) - x);
            if (dx < bestDist) {
              bestDist = dx;
              best = i;
            }
          }
          setHoverIdx(best);
        }}
      >
        <path d={geom.areaPath} fill="currentColor" fillOpacity={0.18} stroke="none" />
        <path d={geom.linePath} fill="none" stroke="currentColor" strokeWidth={1.25} />
        {peakPt ? (
          <circle cx={peakPt.x} cy={peakPt.y} r={1.5} fill="currentColor" fillOpacity={0.7} />
        ) : null}
        {minPt && geom.min < geom.peak ? (
          <circle cx={minPt.x} cy={minPt.y} r={1.2} fill="currentColor" fillOpacity={0.45} />
        ) : null}
        <circle cx={last.x} cy={last.y} r={1.6} fill="currentColor" />
        {hoverPt ? (
          <>
            <line
              x1={hoverPt.x}
              y1={0}
              x2={hoverPt.x}
              y2={height}
              stroke="currentColor"
              strokeOpacity={0.3}
              strokeDasharray="2 2"
            />
            <circle cx={hoverPt.x} cy={hoverPt.y} r={2} fill="currentColor" />
          </>
        ) : null}
      </svg>
      {hoverPt ? (
        <span
          className="bg-card border-border text-foreground pointer-events-none absolute z-10 -translate-x-1/2 rounded border px-1 py-0.5 font-mono text-[10px] shadow-sm"
          style={{
            left: hoverPt.x,
            top: -4,
            transform: `translate(-50%, -100%)`,
          }}
        >
          {hoverVal.toLocaleString()} {unit}
        </span>
      ) : null}
      {/* VROL-807 — announce the focused sample for screen readers. The
          visible tooltip handles sighted users; this is a polite live
          region tucked off-screen for keyboard-only navigation. */}
      <span className="sr-only" aria-live="polite">
        {focused && hoverPt
          ? `Sample ${String((hoverIdx ?? 0) + 1)} of ${String(series.length)}: ${hoverVal.toLocaleString()} ${unit}`.trim()
          : ""}
      </span>
    </span>
  );
}
