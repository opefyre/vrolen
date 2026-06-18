/**
 * Tiny SVG polyline sparkline (VROL-614). Used inside StationNode to show a
 * station's cumulative-completed series at a glance. No chart library — single
 * polyline + currentColor so the parent styles it.
 *
 * Renders nothing when there are fewer than two samples (no line to draw) or
 * when the peak value is zero (avoids a flat baseline that reads as "data").
 */

interface SparklineProps {
  readonly series: readonly number[];
  readonly width?: number;
  readonly height?: number;
}

export function Sparkline({ series, width = 60, height = 20 }: SparklineProps) {
  if (series.length < 2) return null;
  const peak = series.reduce((m, n) => Math.max(m, n), 0);
  if (peak <= 0) return null;
  const yScale = (height - 2) / peak;
  const xStep = series.length > 1 ? (width - 2) / (series.length - 1) : 0;
  let d = "";
  series.forEach((v, i) => {
    const x = 1 + i * xStep;
    const y = height - 1 - v * yScale;
    d += `${i === 0 ? "M" : " L"} ${String(x.toFixed(1))} ${String(y.toFixed(1))}`;
  });
  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      className="text-sim-running"
      role="img"
      aria-label={`Cumulative completed series, peak ${peak.toLocaleString()}`}
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.25} />
    </svg>
  );
}
