/**
 * Miro/Figma-style alignment guides — hook half.
 *
 * Split from the overlay component so this file only exports the
 * hook (react-refresh/only-export-components compliance).
 */

import { type Node, useReactFlow } from "@xyflow/react";
import { useCallback, useState } from "react";

const SNAP_PX = 6;

export interface GuideLine {
  readonly axis: "horizontal" | "vertical";
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

interface DraggingState {
  readonly id: string;
  readonly startPos: { x: number; y: number };
}

interface AnchorRect {
  readonly id: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly hCenter: number;
  readonly vCenter: number;
}

function rectOf(n: Node): AnchorRect | null {
  const w = n.width ?? n.measured?.width;
  const h = n.height ?? n.measured?.height;
  if (typeof w !== "number" || typeof h !== "number") return null;
  return {
    id: n.id,
    left: n.position.x,
    right: n.position.x + w,
    top: n.position.y,
    bottom: n.position.y + h,
    hCenter: n.position.x + w / 2,
    vCenter: n.position.y + h / 2,
  };
}

export function useAlignmentGuides() {
  const flow = useReactFlow();
  const [guideLines, setGuideLines] = useState<readonly GuideLine[]>([]);
  const [dragging, setDragging] = useState<DraggingState | null>(null);

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    setDragging({ id: node.id, startPos: { ...node.position } });
  }, []);

  const onNodeDrag = useCallback(
    (e: React.MouseEvent, node: Node) => {
      const allNodes = flow.getNodes();
      const others = allNodes.filter((n) => n.id !== node.id);
      const me = rectOf(node);
      if (!me) {
        setGuideLines([]);
        return;
      }

      // Shift = axis lock since drag start.
      const shift = e.shiftKey;
      let lockedNode: Node = node;
      const start = dragging?.startPos;
      if (shift && start) {
        const dx = Math.abs(node.position.x - start.x);
        const dy = Math.abs(node.position.y - start.y);
        const axis: "x" | "y" = dx >= dy ? "x" : "y";
        const lockedPos =
          axis === "x" ? { x: node.position.x, y: start.y } : { x: start.x, y: node.position.y };
        if (lockedPos.x !== node.position.x || lockedPos.y !== node.position.y) {
          lockedNode = { ...node, position: lockedPos };
          flow.setNodes((ns) =>
            ns.map((n) => (n.id === node.id ? { ...n, position: lockedPos } : n)),
          );
        }
      }

      const meLive = rectOf(lockedNode) ?? me;
      const guides: GuideLine[] = [];
      const myV = [{ v: meLive.left }, { v: meLive.hCenter }, { v: meLive.right }];
      const myH = [{ v: meLive.top }, { v: meLive.vCenter }, { v: meLive.bottom }];

      let bestDx: { d: number; theirV: number; spanY: [number, number] } | null = null;
      let bestDy: { d: number; theirH: number; spanX: [number, number] } | null = null;

      for (const o of others) {
        const r = rectOf(o);
        if (!r) continue;
        const theirV = [{ v: r.left }, { v: r.hCenter }, { v: r.right }];
        const theirH = [{ v: r.top }, { v: r.vCenter }, { v: r.bottom }];
        for (const m of myV) {
          for (const t of theirV) {
            const d = m.v - t.v;
            if (Math.abs(d) <= SNAP_PX) {
              if (!bestDx || Math.abs(d) < Math.abs(bestDx.d)) {
                bestDx = {
                  d,
                  theirV: t.v,
                  spanY: [Math.min(meLive.top, r.top), Math.max(meLive.bottom, r.bottom)],
                };
              }
            }
          }
        }
        for (const m of myH) {
          for (const t of theirH) {
            const d = m.v - t.v;
            if (Math.abs(d) <= SNAP_PX) {
              if (!bestDy || Math.abs(d) < Math.abs(bestDy.d)) {
                bestDy = {
                  d,
                  theirH: t.v,
                  spanX: [Math.min(meLive.left, r.left), Math.max(meLive.right, r.right)],
                };
              }
            }
          }
        }
      }

      if (bestDx || bestDy) {
        const snapDx = bestDx ? -bestDx.d : 0;
        const snapDy = bestDy ? -bestDy.d : 0;
        if (snapDx !== 0 || snapDy !== 0) {
          flow.setNodes((ns) =>
            ns.map((n) =>
              n.id === node.id
                ? {
                    ...n,
                    position: { x: n.position.x + snapDx, y: n.position.y + snapDy },
                  }
                : n,
            ),
          );
        }
      }

      if (bestDx) {
        guides.push({
          axis: "vertical",
          at: bestDx.theirV,
          from: bestDx.spanY[0],
          to: bestDx.spanY[1],
        });
      }
      if (bestDy) {
        guides.push({
          axis: "horizontal",
          at: bestDy.theirH,
          from: bestDy.spanX[0],
          to: bestDy.spanX[1],
        });
      }
      setGuideLines(guides);
    },
    [flow, dragging],
  );

  const onNodeDragStop = useCallback(() => {
    setGuideLines([]);
    setDragging(null);
  }, []);

  return { guideLines, onNodeDragStart, onNodeDrag, onNodeDragStop };
}
