/**
 * Custom react-flow edge that renders animated SVG dots along the edge path.
 * Dot count + speed scale with the edge's flow rate from the last run
 * (VROL-606).
 *
 * Flow rate is passed via edge.data.flowRate (parts per ms). When 0 or
 * undefined, the edge renders as a standard bezier path with no dots.
 */

import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import { useId } from "react";

const MIN_DURATION_S = 1.5;
const MAX_DURATION_S = 6;
const MAX_DOTS = 5;

export function AnimatedEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY, markerEnd, style } = props;
  const data = (props.data ?? {}) as { flowRate?: number; dotColorClass?: string };
  const flowRate = data.flowRate ?? 0;
  const dotColorClass = data.dotColorClass ?? "text-sim-running";
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition: props.sourcePosition,
    targetX,
    targetY,
    targetPosition: props.targetPosition,
  });
  const pathId = `edge-path-${useId()}`;

  const baseEdgeProps: Parameters<typeof BaseEdge>[0] = {
    id: props.id,
    path: edgePath,
    ...(markerEnd ? { markerEnd } : {}),
    ...(style ? { style } : {}),
  };
  if (flowRate <= 0) {
    return <BaseEdge {...baseEdgeProps} />;
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
    </>
  );
}
