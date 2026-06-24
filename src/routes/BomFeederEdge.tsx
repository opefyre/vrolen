/**
 * VROL-940 — react-flow edge rendering a dotted side-arrow for assembly
 * BOM feeders. The edge does NOT carry parts in the engine (the topology
 * edge from feeder → consumer already does); this is a visual annotation
 * for the canvas that says "this feeder also satisfies a BOM requirement
 * of N units per cycle on the consumer."
 *
 * Renders a thin dashed bezier path tinted in the warning palette so it's
 * distinguishable from primary flow edges, with a small label showing the
 * qtyPerCycle next to the midpoint.
 */

import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";

interface BomFeederEdgeData {
  /** Quantity required per consumer cycle. Shown in the label. */
  qtyPerCycle?: number;
}

export function BomFeederEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY } = props;
  const data = (props.data ?? {}) as BomFeederEdgeData;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  const qty = data.qtyPerCycle ?? 1;
  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: "var(--sim-setup, oklch(0.7 0.15 80))",
          strokeWidth: 1.5,
          strokeDasharray: "4 4",
          opacity: 0.8,
        }}
        markerEnd="url(#bom-feeder-arrow)"
      />
      <EdgeLabelRenderer>
        <div
          className="pointer-events-none absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
          }}
        >
          <span
            className="bg-card text-foreground border-border rounded border px-1.5 py-0.5 font-mono text-[10px] shadow-sm"
            title="BOM feeder — quantity per consumer cycle"
          >
            BOM ×{String(qty)}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
