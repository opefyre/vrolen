/**
 * VROL-941 — react-flow edge for perSkuRouting overrides. Visually
 * distinct from BOM feeders (purple/accent tint, thinner stroke) so the
 * user can read at a glance "main flow / BOM feeder / SKU route" without
 * a legend.
 */

import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from "@xyflow/react";

interface SkuRoutingEdgeData {
  productId?: string;
}

export function SkuRoutingEdge(props: EdgeProps) {
  const { sourceX, sourceY, targetX, targetY } = props;
  const data = (props.data ?? {}) as SkuRoutingEdgeData;
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  });
  return (
    <>
      <BaseEdge
        path={path}
        style={{
          stroke: "var(--accent, oklch(0.6 0.18 280))",
          strokeWidth: 1.25,
          strokeDasharray: "6 3",
          opacity: 0.7,
        }}
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
            title="Per-SKU routing override"
          >
            {data.productId ?? "sku"}
          </span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
