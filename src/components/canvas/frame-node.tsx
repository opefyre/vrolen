/**
 * Miro-style frame: a labeled, resizable, colored container that sits
 * BEHIND regular station nodes. Holds no engine state; lives purely as
 * a visual grouping affordance ("Packing line", "QA loop", …).
 *
 * Resizing: 8 grips — 4 corners + 4 edges — emit pointer-move deltas that
 * update width / height (and for the anchors that pull a top/left edge,
 * the node's position too). Each grip lives in a slot with the `nodrag`
 * className so React Flow doesn't also start a node-drag when the user
 * grabs the grip.
 */

import type { NodeProps } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import { useRef, useState } from "react";

const COLOR_BG: Record<string, string> = {
  blue: "bg-sim-running/10 border-sim-running/30",
  amber: "bg-sim-setup/10 border-sim-setup/35",
  rose: "bg-sim-down/10 border-sim-down/30",
  gray: "bg-muted/40 border-border",
};

const COLOR_LABEL: Record<string, string> = {
  blue: "text-sim-running",
  amber: "text-sim-setup-foreground",
  rose: "text-sim-down-foreground",
  gray: "text-foreground/70",
};

interface FrameData {
  label?: string;
  color?: keyof typeof COLOR_BG;
  width?: number;
  height?: number;
}

const MIN_W = 160;
const MIN_H = 80;

/** Which sides of the frame this grip pulls. Corners pull two sides. */
type Anchor = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

const ANCHOR_CURSORS: Record<Anchor, string> = {
  tl: "cursor-nwse-resize",
  t: "cursor-ns-resize",
  tr: "cursor-nesw-resize",
  r: "cursor-ew-resize",
  br: "cursor-nwse-resize",
  b: "cursor-ns-resize",
  bl: "cursor-nesw-resize",
  l: "cursor-ew-resize",
};

/** Tailwind positioning for each grip. Corners are 8px squares; edge
 *  grips run the length of the edge but stay thin (4px deep). */
const ANCHOR_CLASSES: Record<Anchor, string> = {
  tl: "h-2.5 w-2.5 -top-1 -left-1",
  t: "h-1 left-2 right-2 -top-0.5",
  tr: "h-2.5 w-2.5 -top-1 -right-1",
  r: "w-1 top-2 bottom-2 -right-0.5",
  br: "h-2.5 w-2.5 -bottom-1 -right-1",
  b: "h-1 left-2 right-2 -bottom-0.5",
  bl: "h-2.5 w-2.5 -bottom-1 -left-1",
  l: "w-1 top-2 bottom-2 -left-0.5",
};

export function FrameNode(props: NodeProps) {
  const data = (props.data ?? {}) as FrameData;
  const label = data.label ?? "Section";
  const color: keyof typeof COLOR_BG = data.color && COLOR_BG[data.color] ? data.color : "blue";
  const flow = useReactFlow();
  const width = Math.max(MIN_W, Number(data.width ?? 320));
  const height = Math.max(MIN_H, Number(data.height ?? 200));
  // Local label-edit state — committed on Enter / blur. The draft seeds
  // from the current label each time edit starts (no effect needed).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(label);

  // Pointer-drag resize. Tracks the starting box (top-left position +
  // size) so corner/edge anchors can shift both dimensions and position
  // consistently regardless of which edge is being pulled.
  const resizeStartRef = useRef<{
    anchor: Anchor;
    wPx: number;
    hPx: number;
    xPx: number;
    yPx: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const onResizePointerDown =
    (anchor: Anchor) =>
    (e: React.PointerEvent): void => {
      e.stopPropagation();
      e.preventDefault();
      const node = flow.getNode(props.id);
      resizeStartRef.current = {
        anchor,
        wPx: width,
        hPx: height,
        xPx: node?.position.x ?? 0,
        yPx: node?.position.y ?? 0,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    };

  const onResizePointerMove = (e: React.PointerEvent): void => {
    const start = resizeStartRef.current;
    if (!start) return;
    e.stopPropagation();
    const zoom = flow.getZoom();
    const dx = (e.clientX - start.clientX) / zoom;
    const dy = (e.clientY - start.clientY) / zoom;
    // Decompose anchor into which edges move. left/top edges also shift
    // the node's position; right/bottom edges only change size.
    const pullLeft = start.anchor === "tl" || start.anchor === "l" || start.anchor === "bl";
    const pullRight = start.anchor === "tr" || start.anchor === "r" || start.anchor === "br";
    const pullTop = start.anchor === "tl" || start.anchor === "t" || start.anchor === "tr";
    const pullBottom = start.anchor === "bl" || start.anchor === "b" || start.anchor === "br";
    let nextW = start.wPx;
    let nextH = start.hPx;
    let nextX = start.xPx;
    let nextY = start.yPx;
    if (pullRight) nextW = start.wPx + dx;
    if (pullLeft) {
      // Clamp dx so the resulting width never drops below MIN_W.
      const clampedDx = Math.min(dx, start.wPx - MIN_W);
      nextW = start.wPx - clampedDx;
      nextX = start.xPx + clampedDx;
    }
    if (pullBottom) nextH = start.hPx + dy;
    if (pullTop) {
      const clampedDy = Math.min(dy, start.hPx - MIN_H);
      nextH = start.hPx - clampedDy;
      nextY = start.yPx + clampedDy;
    }
    nextW = Math.max(MIN_W, Math.round(nextW));
    nextH = Math.max(MIN_H, Math.round(nextH));
    nextX = Math.round(nextX);
    nextY = Math.round(nextY);
    flow.setNodes((ns) =>
      ns.map((n) =>
        n.id === props.id
          ? {
              ...n,
              position: { x: nextX, y: nextY },
              data: { ...(n.data as Record<string, unknown>), width: nextW, height: nextH },
              width: nextW,
              height: nextH,
            }
          : n,
      ),
    );
  };

  const onResizePointerUp = (e: React.PointerEvent): void => {
    resizeStartRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const commitLabel = (): void => {
    flow.setNodes((ns) =>
      ns.map((n) =>
        n.id === props.id
          ? {
              ...n,
              data: { ...(n.data as Record<string, unknown>), label: draft.trim() || "Section" },
            }
          : n,
      ),
    );
    setEditing(false);
  };

  const ANCHORS: readonly Anchor[] = ["tl", "t", "tr", "r", "br", "b", "bl", "l"];

  return (
    <div
      style={{ width, height }}
      className={`${COLOR_BG[color]} relative rounded-md border-2 border-dashed shadow-sm`}
    >
      {/* Top-left label. Click to rename. */}
      <div
        className={`${COLOR_LABEL[color]} pointer-events-auto absolute top-1.5 left-2 font-mono text-[11px] font-semibold tracking-wide uppercase`}
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      >
        {editing ? (
          <input
            ref={(el) => {
              // Focus on mount without using the autoFocus prop (a11y rule).
              if (el && document.activeElement !== el) el.focus();
            }}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setDraft(label);
                setEditing(false);
              }
            }}
            className="bg-card/90 w-40 rounded border px-1 text-[11px]"
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => {
              setDraft(label);
              setEditing(true);
            }}
            className="cursor-text"
            title="Double-click to rename"
          >
            {label}
          </button>
        )}
      </div>
      {/* 8 resize grips. Each has the `nodrag` className so React Flow
          doesn't also start a node-drag when the user grabs a grip
          (that was the source of the position-drift bug). */}
      {ANCHORS.map((anchor) => (
        <div
          key={anchor}
          role="separator"
          aria-label={`Resize frame ${anchor}`}
          onPointerDown={onResizePointerDown(anchor)}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerUp}
          className={`nodrag bg-foreground/40 hover:bg-foreground/70 absolute z-10 rounded-sm ${ANCHOR_CLASSES[anchor]} ${ANCHOR_CURSORS[anchor]}`}
          style={{ touchAction: "none" }}
        />
      ))}
    </div>
  );
}
