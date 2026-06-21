/**
 * Custom react-flow edge that renders animated SVG dots along the edge path.
 * Dot count + speed scale with the edge's flow rate from the last run
 * (VROL-606).
 *
 * Flow rate is passed via edge.data.flowRate (parts per ms). When 0 or
 * undefined, the edge renders as a standard bezier path with no dots.
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  useReactFlow,
} from "@xyflow/react";
import { useId } from "react";

export type EdgeLineShape = "smoothstep" | "bezier" | "straight";
export type EdgeArrowMode = "end" | "start" | "both" | "none";

import { Sparkline } from "./Sparkline";

const MIN_DURATION_S = 1.5;
const MAX_DURATION_S = 6;
const MAX_DOTS = 5;

export function AnimatedEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, style } = props;
  const data = (props.data ?? {}) as {
    flowRate?: number;
    dotColorClass?: string;
    bufferFillSeries?: number[];
    bufferCapacity?: number;
    /** Live buffer fill at current playback time. */
    playbackFillNow?: number;
    /** Run peak fill — used to normalise the live width. */
    playbackPeak?: number;
    /** Miro-style edge styling (Sprint 84). */
    lineShape?: EdgeLineShape;
    lineDash?: boolean;
    arrowMode?: EdgeArrowMode;
    strokeColor?: string;
  };
  const flowRate = data.flowRate ?? 0;
  const dotColorClass = data.dotColorClass ?? "text-sim-running";
  const series = data.bufferFillSeries;
  const playbackFillNow = data.playbackFillNow;
  const playbackPeak = data.playbackPeak;
  const lineShape: EdgeLineShape = data.lineShape ?? "smoothstep";
  const lineDash = data.lineDash === true;
  const arrowMode: EdgeArrowMode = data.arrowMode ?? "end";
  const strokeColor = data.strokeColor;
  // Path generator — user-selected. smoothstep = orthogonal w/ rounded
  // corners (default), bezier = curve, straight = straight line.
  const pathArgs = {
    sourceX,
    sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition,
  } as const;
  const [edgePath, labelX, labelY] =
    lineShape === "bezier"
      ? getBezierPath(pathArgs)
      : lineShape === "straight"
        ? getStraightPath({ sourceX, sourceY, targetX, targetY })
        : getSmoothStepPath({ ...pathArgs, borderRadius: 12 });
  const pathId = `edge-path-${useId()}`;
  const flow = useReactFlow();

  // Sprint 88 — mid-edge × delete button removed. Right-click → Delete
  // edge and the keyboard Delete key both already cover edge deletion.

  // Invisible stroke directly under the visible edge so the hit-target is
  // a bit more forgiving than the 1.5px visible line — but narrow enough
  // that two edges converging on the same handle don't share a click
  // region. Sprint 90: dropped from 18 → 10 px after users reported only
  // ever being able to select the leftmost of two adjacent edges.
  const hitArea = (
    <path
      d={edgePath}
      stroke="transparent"
      strokeWidth={10}
      fill="none"
      style={{ pointerEvents: "stroke" }}
      onClick={() => {
        // Don't stopPropagation — let react-flow's onEdgeClick handler in
        // EditorPage see the click and update its selection state.
        flow.setEdges((eds) =>
          eds.map((ed) => ({
            ...ed,
            selected: ed.id === props.id,
          })),
        );
        flow.setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
      }}
    />
  );

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

  const showArrowEnd = arrowMode === "end" || arrowMode === "both";
  const showArrowStart = arrowMode === "start" || arrowMode === "both";
  const arrowEndId = `arrow-end-${props.id}`;
  const arrowStartId = `arrow-start-${props.id}`;
  const arrowColor = strokeColor ?? playbackStrokeColor ?? "var(--foreground)";
  // Render our own arrow markers in <defs> for full control over fill +
  // direction (start/end). Two SVG markers per edge, only added when needed.
  const arrowDefs = (
    <defs>
      {showArrowEnd ? (
        <marker
          id={arrowEndId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={arrowColor} />
        </marker>
      ) : null}
      {showArrowStart ? (
        <marker
          id={arrowStartId}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="12"
          markerHeight="12"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={arrowColor} />
        </marker>
      ) : null}
    </defs>
  );
  const baseEdgeProps: Parameters<typeof BaseEdge>[0] = {
    id: props.id,
    path: edgePath,
    ...(showArrowEnd ? { markerEnd: `url(#${arrowEndId})` } : {}),
    ...(showArrowStart ? { markerStart: `url(#${arrowStartId})` } : {}),
    style: {
      ...(style ?? {}),
      ...(playbackStrokeWidth ? { strokeWidth: playbackStrokeWidth } : {}),
      ...(playbackStrokeColor
        ? { stroke: playbackStrokeColor }
        : strokeColor
          ? { stroke: strokeColor }
          : {}),
      ...(lineDash ? { strokeDasharray: "6 4" } : {}),
    },
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
        {arrowDefs}
        <BaseEdge {...baseEdgeProps} />
        {hitArea}
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
      {arrowDefs}
      <BaseEdge {...baseEdgeProps} />
      {hitArea}
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
