/**
 * Custom react-flow edge that renders animated SVG dots along the edge path.
 * Dot count + speed scale with the edge's flow rate from the last run
 * (VROL-606).
 *
 * Flow rate is passed via edge.data.flowRate (parts per ms). When 0 or
 * undefined, the edge renders as a standard bezier path with no dots.
 */

import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useId } from "react";

import { Sparkline } from "./Sparkline";

const MIN_DURATION_S = 1.5;
const MAX_DURATION_S = 6;
const MAX_DOTS = 5;

export function AnimatedEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, markerEnd, style } = props;
  const data = (props.data ?? {}) as {
    flowRate?: number;
    dotColorClass?: string;
    bufferFillSeries?: number[];
    bufferCapacity?: number;
    /** Live buffer fill at current playback time. */
    playbackFillNow?: number;
    /** Run peak fill — used to normalise the live width. */
    playbackPeak?: number;
  };
  const flowRate = data.flowRate ?? 0;
  const dotColorClass = data.dotColorClass ?? "text-sim-running";
  const series = data.bufferFillSeries;
  const playbackFillNow = data.playbackFillNow;
  const playbackPeak = data.playbackPeak;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition,
  });
  const pathId = `edge-path-${useId()}`;

  // Live playback — fatten the edge by current buffer fill so the user
  // sees congestion in real time. Stroke color shifts toward the
  // bottleneck reason at the same time (carried by dotColorClass).
  const playbackStrokeWidth =
    typeof playbackFillNow === "number" && typeof playbackPeak === "number" && playbackPeak > 0
      ? 1.5 + 4 * Math.min(1, playbackFillNow / playbackPeak)
      : undefined;
  const playbackStrokeColor =
    typeof playbackFillNow === "number" && typeof playbackPeak === "number" && playbackPeak > 0
      ? // High fill → blocked-ish color; low fill → running.
        playbackFillNow / playbackPeak > 0.7
        ? "var(--sim-blocked)"
        : playbackFillNow / playbackPeak > 0.3
          ? "var(--sim-setup)"
          : "var(--sim-running)"
      : undefined;

  const baseEdgeProps: Parameters<typeof BaseEdge>[0] = {
    id: props.id,
    path: edgePath,
    ...(markerEnd ? { markerEnd } : {}),
    ...(style || playbackStrokeWidth
      ? {
          style: {
            ...(style ?? {}),
            ...(playbackStrokeWidth ? { strokeWidth: playbackStrokeWidth } : {}),
            ...(playbackStrokeColor ? { stroke: playbackStrokeColor } : {}),
          },
        }
      : {}),
  };
  // VROL-615 — render the buffer-fill sparkline above the edge midpoint when
  // the run carried a sampler. Stays visible even when animation / flow dots
  // are off — sparklines are a per-run summary, not a live effect.
  const sparkline =
    Array.isArray(series) && series.length > 1 ? (
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -110%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            pointerEvents: "none",
          }}
          className="bg-card/85 text-sim-running border-border rounded border px-1 py-0.5 shadow-sm"
          title="Buffer fill over time"
        >
          <Sparkline series={series} width={48} height={14} />
        </div>
      </EdgeLabelRenderer>
    ) : null;

  if (flowRate <= 0) {
    return (
      <>
        <BaseEdge {...baseEdgeProps} />
        {sparkline}
      </>
    );
  }

  // Dot count: log scale of parts/hour, capped.
  const partsPerHour = flowRate * 3_600_000;
  const dotCount = Math.min(
    MAX_DOTS,
    Math.max(1, Math.round(Math.log10(Math.max(1, partsPerHour)))),
  );
  // Duration: faster = shorter; scale on log too.
  const durationS = Math.max(
    MIN_DURATION_S,
    Math.min(MAX_DURATION_S, MAX_DURATION_S - Math.log10(Math.max(1, partsPerHour))),
  );

  return (
    <>
      <BaseEdge {...baseEdgeProps} />
      <defs>
        <path id={pathId} d={edgePath} fill="none" />
      </defs>
      {Array.from({ length: dotCount }, (_, i) => (
        <circle key={i} r={3.5} fill="currentColor" className={dotColorClass}>
          <animateMotion
            dur={`${String(durationS)}s`}
            repeatCount="indefinite"
            begin={`${String((i * durationS) / dotCount)}s`}
            rotate="auto"
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
      {sparkline}
    </>
  );
}
