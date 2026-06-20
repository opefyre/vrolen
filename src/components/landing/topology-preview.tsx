/**
 * VROL-666 — tiny SVG preview of a preset's topology. Nodes as colored
 * circles by stationType, edges as straight lines. Auto-fits the
 * preset's node bounding box into a fixed 280×120 viewbox.
 */

import type { Edge, Node } from "@xyflow/react";

const VIEW_W = 280;
const VIEW_H = 120;
const PAD = 12;
const NODE_R = 5;

const TYPE_COLOR: Record<string, string> = {
  machine: "text-sim-running",
  manual: "text-sim-setup",
  buffer: "text-sim-blocked",
  qc: "text-sim-setup",
  assembly: "text-sim-running",
  transport: "text-sim-blocked",
  input: "text-sim-idle",
  output: "text-sim-maintenance",
  custom: "text-muted-foreground",
};

interface TopologyPreviewProps {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
}

export function TopologyPreview({ nodes, edges }: TopologyPreviewProps) {
  if (nodes.length === 0) return null;

  // Fit positions into the viewbox.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.x > maxX) maxX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
    if (n.position.y > maxY) maxY = n.position.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const sx = (VIEW_W - PAD * 2) / w;
  const sy = (VIEW_H - PAD * 2) / h;
  const project = (x: number, y: number): { x: number; y: number } => ({
    x: PAD + (x - minX) * sx,
    y: PAD + (y - minY) * sy,
  });

  const posById = new Map<string, { x: number; y: number }>();
  for (const n of nodes) posById.set(n.id, project(n.position.x, n.position.y));

  return (
    <svg viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`} className="h-20 w-full" aria-hidden>
      {/* VROL-757 — node + edge counts in the corner. */}
      <text
        x={VIEW_W - 4}
        y={VIEW_H - 4}
        textAnchor="end"
        className="fill-muted-foreground"
        style={{ fontSize: 9, fontFamily: "ui-monospace, monospace" }}
      >
        {nodes.length}n · {edges.length}e
      </text>
      {edges.map((e) => {
        const a = posById.get(e.source);
        const b = posById.get(e.target);
        if (!a || !b) return null;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="currentColor"
            strokeOpacity={0.25}
            strokeWidth={1}
            className="text-foreground"
          />
        );
      })}
      {nodes.map((n) => {
        const p = posById.get(n.id);
        if (!p) return null;
        const t = (n.data as { stationType?: string }).stationType ?? "machine";
        const colorClass = TYPE_COLOR[t] ?? TYPE_COLOR.machine!;
        return (
          <circle
            key={n.id}
            cx={p.x}
            cy={p.y}
            r={NODE_R}
            fill="currentColor"
            className={colorClass}
          />
        );
      })}
    </svg>
  );
}
