/**
 * Miro/Figma-style alignment guides — hook half.
 *
 * Design notes (post-feedback rewrite):
 *
 *   1. Guides only render while a node is ACTIVELY being dragged. The
 *      previous version left stale guides on the canvas after the
 *      drag ended because onNodeDragStop didn't always fire (e.g.
 *      pointer left the canvas). We belt-and-suspender by also clearing
 *      on global pointerup / pointercancel.
 *
 *   2. We DO NOT call flow.setNodes() during drag to snap. That fights
 *      React Flow's internal drag loop and makes motion feel jittery.
 *      Instead, we just show the candidate guide line while dragging
 *      and apply the snap (single setNodes) on drag STOP. The user
 *      releases on the guide and the node clicks into place crisply.
 *
 *   3. We use refs (not useState) for the live dragging state so the
 *      first drag tick already has the start position — useState
 *      updates batch across events, so the closure would otherwise
 *      see `null` for the first few ticks.
 */

import { type Node, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";

const SNAP_PX = 6;

export interface GuideLine {
  readonly axis: "horizontal" | "vertical";
  readonly at: number;
  readonly from: number;
  readonly to: number;
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

interface DragMatch {
  readonly bestDx: number; // signed delta TO subtract from the dragged node's x to snap
  readonly bestDy: number; // signed delta TO subtract from the dragged node's y to snap
  readonly guides: readonly GuideLine[];
}

function computeMatch(meLive: AnchorRect, others: readonly Node[]): DragMatch {
  const myV = [meLive.left, meLive.hCenter, meLive.right];
  const myH = [meLive.top, meLive.vCenter, meLive.bottom];

  let bestDx: { d: number; theirV: number; spanY: [number, number] } | null = null;
  let bestDy: { d: number; theirH: number; spanX: [number, number] } | null = null;

  for (const o of others) {
    const r = rectOf(o);
    if (!r) continue;
    const theirV = [r.left, r.hCenter, r.right];
    const theirH = [r.top, r.vCenter, r.bottom];
    for (const m of myV) {
      for (const t of theirV) {
        const d = m - t;
        if (Math.abs(d) <= SNAP_PX) {
          if (!bestDx || Math.abs(d) < Math.abs(bestDx.d)) {
            bestDx = {
              d,
              theirV: t,
              spanY: [Math.min(meLive.top, r.top), Math.max(meLive.bottom, r.bottom)],
            };
          }
        }
      }
    }
    for (const m of myH) {
      for (const t of theirH) {
        const d = m - t;
        if (Math.abs(d) <= SNAP_PX) {
          if (!bestDy || Math.abs(d) < Math.abs(bestDy.d)) {
            bestDy = {
              d,
              theirH: t,
              spanX: [Math.min(meLive.left, r.left), Math.max(meLive.right, r.right)],
            };
          }
        }
      }
    }
  }

  const guides: GuideLine[] = [];
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
  return {
    bestDx: bestDx ? bestDx.d : 0,
    bestDy: bestDy ? bestDy.d : 0,
    guides,
  };
}

export function useAlignmentGuides() {
  const flow = useReactFlow();
  const [guideLines, setGuideLines] = useState<readonly GuideLine[]>([]);
  // Live drag state in refs so the first drag tick already has the start.
  const draggingRef = useRef<{
    id: string;
    startPos: { x: number; y: number };
    pendingSnap: { dx: number; dy: number } | null;
  } | null>(null);

  const clearGuides = useCallback(() => {
    if (draggingRef.current !== null || guideLines.length > 0) {
      draggingRef.current = null;
      setGuideLines([]);
    }
  }, [guideLines.length]);

  // Belt-and-suspenders: a global pointerup or pointercancel clears
  // the guides + drag state even if React Flow's onNodeDragStop
  // doesn't fire (pointer left the canvas, browser fired a different
  // event, etc.). Without this the previous version left stale
  // dashed lines on the canvas.
  useEffect(() => {
    const onUp = (): void => {
      clearGuides();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [clearGuides]);

  const onNodeDragStart = useCallback((_e: React.MouseEvent, node: Node) => {
    draggingRef.current = {
      id: node.id,
      startPos: { ...node.position },
      pendingSnap: null,
    };
    setGuideLines([]);
  }, []);

  const onNodeDrag = useCallback(
    (e: React.MouseEvent, node: Node) => {
      const drag = draggingRef.current;
      if (!drag || drag.id !== node.id) {
        // Drag of something else; don't render guides for it.
        return;
      }

      // Shift = axis lock since drag start. We DO apply this via
      // setNodes — it's a constraint, not a snap, and it's the
      // standard expectation when Shift is held.
      const shift = e.shiftKey;
      let livePosition = node.position;
      if (shift) {
        const dx = Math.abs(node.position.x - drag.startPos.x);
        const dy = Math.abs(node.position.y - drag.startPos.y);
        const axis: "x" | "y" = dx >= dy ? "x" : "y";
        const locked =
          axis === "x"
            ? { x: node.position.x, y: drag.startPos.y }
            : { x: drag.startPos.x, y: node.position.y };
        if (locked.x !== node.position.x || locked.y !== node.position.y) {
          livePosition = locked;
          flow.setNodes((ns) => ns.map((n) => (n.id === node.id ? { ...n, position: locked } : n)));
        }
      }

      const me: AnchorRect | null = (() => {
        const w = node.width ?? node.measured?.width;
        const h = node.height ?? node.measured?.height;
        if (typeof w !== "number" || typeof h !== "number") return null;
        return {
          id: node.id,
          left: livePosition.x,
          right: livePosition.x + w,
          top: livePosition.y,
          bottom: livePosition.y + h,
          hCenter: livePosition.x + w / 2,
          vCenter: livePosition.y + h / 2,
        };
      })();
      if (!me) {
        setGuideLines([]);
        return;
      }

      const others = flow.getNodes().filter((n) => n.id !== node.id);
      const match = computeMatch(me, others);

      // Remember which snap WOULD apply if the user dropped now.
      drag.pendingSnap =
        match.bestDx !== 0 || match.bestDy !== 0 ? { dx: match.bestDx, dy: match.bestDy } : null;

      setGuideLines(match.guides);
    },
    [flow],
  );

  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      const drag = draggingRef.current;
      const snap = drag?.pendingSnap;
      // Apply the deferred snap once, on drop, so the drag itself
      // stays smooth (React Flow's internal drag isn't fought).
      if (drag?.id === node.id && snap && (snap.dx !== 0 || snap.dy !== 0)) {
        flow.setNodes((ns) =>
          ns.map((n) =>
            n.id === node.id
              ? {
                  ...n,
                  position: {
                    x: n.position.x - snap.dx,
                    y: n.position.y - snap.dy,
                  },
                }
              : n,
          ),
        );
      }
      draggingRef.current = null;
      setGuideLines([]);
    },
    [flow],
  );

  return { guideLines, onNodeDragStart, onNodeDrag, onNodeDragStop };
}
