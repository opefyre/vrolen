/**
 * Miro-style frame: a labeled, resizable, colored container that sits
 * BEHIND regular station nodes. Holds no engine state; lives purely as
 * a visual grouping affordance ("Packing line", "QA loop", …).
 *
 * Resizing: a bottom-right grip emits pointer-move deltas that update
 * data.width / data.height. The node mounts a transparent rounded
 * rectangle with the label pinned to the top-left.
 *
 * Re-parenting nodes onto a frame is intentionally NOT modeled — the
 * frame is visual only. That keeps the engine translator untouched.
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

  // Pointer-drag resize from the bottom-right grip. Tracks deltas in
  // flow coords (translated via React Flow's screenToFlowPosition).
  const resizeStartRef = useRef<{
    wPx: number;
    hPx: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const onResizePointerDown = (e: React.PointerEvent): void => {
    e.stopPropagation();
    resizeStartRef.current = {
      wPx: width,
      hPx: height,
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
    const nextW = Math.max(MIN_W, Math.round(start.wPx + dx));
    const nextH = Math.max(MIN_H, Math.round(start.hPx + dy));
    flow.setNodes((ns) =>
      ns.map((n) =>
        n.id === props.id
          ? {
              ...n,
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
      {/* Bottom-right resize grip. */}
      <div
        role="separator"
        aria-label="Resize frame"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        className="bg-foreground/60 absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize rounded-br-md"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
