/**
 * Pure node-alignment math. Takes a list of nodes (only width/height/
 * position used) and returns a new list with the requested operation
 * applied to the SELECTED nodes only. Untouched nodes pass through.
 *
 * Distribute requires ≥3 selected nodes to make sense — fewer is a
 * no-op. Tidy up snaps every selected node's top-left to the supplied
 * grid (default 8 px) and is the only op that touches single-selection
 * gracefully (it just snaps).
 */

import type { Node } from "@xyflow/react";

import type { AlignOp } from "@/components/canvas/alignment-toolbar";

const FALLBACK_W = 180;
const FALLBACK_H = 60;

function widthOf(n: Node): number {
  return n.width ?? n.measured?.width ?? FALLBACK_W;
}
function heightOf(n: Node): number {
  return n.height ?? n.measured?.height ?? FALLBACK_H;
}

export function applyAlignment(
  nodes: readonly Node[],
  selectedIds: readonly string[],
  op: AlignOp,
  gridPx = 8,
): Node[] {
  const sel = new Set(selectedIds);
  const targets = nodes.filter((n) => sel.has(n.id));
  if (targets.length < 1) return [...nodes];
  if (op !== "tidy-up" && targets.length < 2) return [...nodes];
  if ((op === "distribute-h" || op === "distribute-v") && targets.length < 3) return [...nodes];

  // Common metrics.
  const lefts = targets.map((n) => n.position.x);
  const rights = targets.map((n) => n.position.x + widthOf(n));
  const tops = targets.map((n) => n.position.y);
  const bottoms = targets.map((n) => n.position.y + heightOf(n));
  const minLeft = Math.min(...lefts);
  const maxRight = Math.max(...rights);
  const minTop = Math.min(...tops);
  const maxBottom = Math.max(...bottoms);
  const centerX = (minLeft + maxRight) / 2;
  const centerY = (minTop + maxBottom) / 2;

  const remap = new Map<string, { x: number; y: number }>();

  if (op === "align-left") {
    for (const n of targets) remap.set(n.id, { x: minLeft, y: n.position.y });
  } else if (op === "align-right") {
    for (const n of targets) remap.set(n.id, { x: maxRight - widthOf(n), y: n.position.y });
  } else if (op === "align-h-center") {
    for (const n of targets) remap.set(n.id, { x: centerX - widthOf(n) / 2, y: n.position.y });
  } else if (op === "align-top") {
    for (const n of targets) remap.set(n.id, { x: n.position.x, y: minTop });
  } else if (op === "align-bottom") {
    for (const n of targets) remap.set(n.id, { x: n.position.x, y: maxBottom - heightOf(n) });
  } else if (op === "align-v-center") {
    for (const n of targets) remap.set(n.id, { x: n.position.x, y: centerY - heightOf(n) / 2 });
  } else if (op === "distribute-h") {
    // Sort by x-center, hold endpoints fixed, evenly space the gaps.
    const sorted = [...targets].sort(
      (a, b) => a.position.x + widthOf(a) / 2 - (b.position.x + widthOf(b) / 2),
    );
    const totalW = sorted.reduce((s, n) => s + widthOf(n), 0);
    const span = maxRight - minLeft;
    const gap = (span - totalW) / (sorted.length - 1);
    let cur = minLeft;
    for (const n of sorted) {
      remap.set(n.id, { x: cur, y: n.position.y });
      cur += widthOf(n) + gap;
    }
  } else if (op === "distribute-v") {
    const sorted = [...targets].sort(
      (a, b) => a.position.y + heightOf(a) / 2 - (b.position.y + heightOf(b) / 2),
    );
    const totalH = sorted.reduce((s, n) => s + heightOf(n), 0);
    const span = maxBottom - minTop;
    const gap = (span - totalH) / (sorted.length - 1);
    let cur = minTop;
    for (const n of sorted) {
      remap.set(n.id, { x: n.position.x, y: cur });
      cur += heightOf(n) + gap;
    }
  } else if (op === "tidy-up") {
    for (const n of targets) {
      remap.set(n.id, {
        x: Math.round(n.position.x / gridPx) * gridPx,
        y: Math.round(n.position.y / gridPx) * gridPx,
      });
    }
  }

  return nodes.map((n) => {
    const pos = remap.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}
