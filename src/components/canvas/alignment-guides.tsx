/**
 * Alignment guides overlay — component half.
 *
 * Renders crimson dashed lines in flow-space using the live ReactFlow
 * viewport transform. The hook in use-alignment-guides.ts owns the
 * snap logic; this file is the renderer.
 */

import { useStore, useViewport } from "@xyflow/react";

import type { GuideLine } from "./use-alignment-guides";

interface AlignmentGuidesOverlayProps {
  readonly guideLines: readonly GuideLine[];
}

export function AlignmentGuidesOverlay({ guideLines }: AlignmentGuidesOverlayProps) {
  const viewport = useViewport();
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  if (guideLines.length === 0) return null;
  return (
    <svg
      width={width}
      height={height}
      className="pointer-events-none absolute top-0 left-0 z-[1]"
      style={{ overflow: "visible" }}
    >
      <g
        transform={`translate(${String(viewport.x)} ${String(viewport.y)}) scale(${String(viewport.zoom)})`}
      >
        {guideLines.map((g, i) => {
          if (g.axis === "vertical") {
            return (
              <line
                key={i}
                x1={g.at}
                y1={g.from - 24}
                x2={g.at}
                y2={g.to + 24}
                stroke="#ec4899"
                strokeWidth={1 / viewport.zoom}
                strokeDasharray={`${String(4 / viewport.zoom)} ${String(3 / viewport.zoom)}`}
              />
            );
          }
          return (
            <line
              key={i}
              x1={g.from - 24}
              y1={g.at}
              x2={g.to + 24}
              y2={g.at}
              stroke="#ec4899"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray={`${String(4 / viewport.zoom)} ${String(3 / viewport.zoom)}`}
            />
          );
        })}
      </g>
    </svg>
  );
}
