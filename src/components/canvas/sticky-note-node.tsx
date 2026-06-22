/**
 * Sticky note node — Miro-style annotation. Free-text, draggable, no
 * ports (doesn't connect to stations). Double-click to edit, blur to
 * commit. Stored as a normal React-Flow node with `type: "sticky"` so
 * the layout / save flow handles it for free.
 *
 * VROL-785 — adds:
 *  • Bottom-right resize grip (min 120×80, max 480×360), persisted to
 *    `data.width` + `data.height`. The grip follows the FrameNode pattern
 *    of an absolutely-positioned `nodrag` slot that pointer-captures
 *    while dragging.
 *  • 5-swatch color picker — yellow (default), blue, rose, green, gray —
 *    rendered as small dots in the top-right while the note is selected.
 *  • Author bubble — small initialled circle at top-left. `data.author`
 *    defaults to "You". Cosmetic placeholder for a future collaboration
 *    surface.
 */

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";

// eslint-disable-next-line react-refresh/only-export-components -- shared constant
export const STICKY_COLORS = ["yellow", "blue", "rose", "green", "gray"] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

const COLOR_CLASSES: Record<StickyColor, string> = {
  yellow: "bg-amber-100 text-amber-900 border-amber-300",
  blue: "bg-blue-100 text-blue-900 border-blue-300",
  rose: "bg-rose-100 text-rose-900 border-rose-300",
  green: "bg-emerald-100 text-emerald-900 border-emerald-300",
  gray: "bg-zinc-100 text-zinc-900 border-zinc-300",
};

const SWATCH_DOT: Record<StickyColor, string> = {
  yellow: "bg-amber-300",
  blue: "bg-blue-300",
  rose: "bg-rose-300",
  green: "bg-emerald-300",
  gray: "bg-zinc-300",
};

interface StickyData {
  readonly text?: string;
  readonly color?: StickyColor;
  /** VROL-785 — persisted resize state. */
  readonly width?: number;
  readonly height?: number;
  /**
   * VROL-785 — cosmetic placeholder for collaboration. The first letter is
   * shown in a bubble at the top-left; the full string surfaces as a tooltip.
   */
  readonly author?: string;
}

export const STICKY_MIN_W = 120;
export const STICKY_MIN_H = 80;
export const STICKY_MAX_W = 480;
export const STICKY_MAX_H = 360;
export const STICKY_DEFAULT_W = 176;
export const STICKY_DEFAULT_H = 112;

function clampSize(w: number, h: number): { width: number; height: number } {
  return {
    width: Math.max(STICKY_MIN_W, Math.min(STICKY_MAX_W, Math.round(w))),
    height: Math.max(STICKY_MIN_H, Math.min(STICKY_MAX_H, Math.round(h))),
  };
}

export function StickyNoteNode({ data, id, selected }: NodeProps) {
  const d = data as StickyData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(d.text ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const flow = useReactFlow();
  const color: StickyColor = (STICKY_COLORS as readonly string[]).includes(d.color ?? "")
    ? (d.color as StickyColor)
    : "yellow";
  const width = clampSize(d.width ?? STICKY_DEFAULT_W, d.height ?? STICKY_DEFAULT_H).width;
  const height = clampSize(d.width ?? STICKY_DEFAULT_W, d.height ?? STICKY_DEFAULT_H).height;
  const author = (d.author ?? "You").trim() || "You";
  const initial = author.slice(0, 1).toUpperCase();

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      taRef.current.select();
    }
  }, [editing]);

  const commit = useCallback(
    (next: string) => {
      flow.setNodes((nodes) =>
        nodes.map((n) => {
          if (n.id !== id) return n;
          return { ...n, data: { ...(n.data as object), text: next } };
        }),
      );
    },
    [flow, id],
  );

  const setColor = useCallback(
    (nextColor: StickyColor) => {
      flow.setNodes((nodes) =>
        nodes.map((n) => {
          if (n.id !== id) return n;
          return { ...n, data: { ...(n.data as object), color: nextColor } };
        }),
      );
    },
    [flow, id],
  );

  // Pointer-drag resize. Same pattern as FrameNode — track the starting
  // box + cursor so deltas are zoom-independent. Only a bottom-right grip:
  // sticky notes don't justify the full 8-anchor frame treatment.
  const resizeStartRef = useRef<{
    wPx: number;
    hPx: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const onResizePointerDown = (e: React.PointerEvent): void => {
    e.stopPropagation();
    e.preventDefault();
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
    const { width: nextW, height: nextH } = clampSize(start.wPx + dx, start.hPx + dy);
    flow.setNodes((ns) =>
      ns.map((n) =>
        n.id === id
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

  return (
    <div
      style={{ width, height, fontFamily: "Caveat, 'Comic Sans MS', cursive" }}
      className={`group relative rounded-md border-2 p-3 shadow-md transition-shadow ${
        COLOR_CLASSES[color]
      } ${selected ? "ring-foreground/40 ring-2" : ""}`}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(d.text ?? "");
        setEditing(true);
      }}
      title="Double-click to edit"
      data-testid="sticky-note"
    >
      {/* Author bubble — cosmetic placeholder for collaboration. */}
      <span
        className="bg-foreground/80 text-background absolute -top-2 -left-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/40 text-[10px] font-semibold shadow-sm select-none"
        title={author}
        aria-label={`Author ${author}`}
        data-testid="sticky-author-bubble"
      >
        {initial}
      </span>
      {/* 5-swatch color picker — only visible while the note is selected. */}
      {selected ? (
        <div
          className="bg-card/90 absolute top-1 right-1 flex gap-1 rounded-full border border-white/40 p-1 shadow-sm"
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          data-testid="sticky-swatches"
        >
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`${c} sticky color`}
              aria-pressed={c === color}
              onClick={(e) => {
                e.stopPropagation();
                setColor(c);
              }}
              className={`h-3 w-3 rounded-full border ${SWATCH_DOT[c]} ${
                c === color ? "ring-foreground ring-1 ring-offset-1" : "border-white/60"
              }`}
            />
          ))}
        </div>
      ) : null}
      {editing ? (
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
          }}
          onBlur={() => {
            commit(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              commit(draft);
              setEditing(false);
            }
          }}
          rows={3}
          className="h-full w-full resize-none bg-transparent text-base leading-snug outline-none"
          style={{ fontFamily: "inherit" }}
        />
      ) : (
        <p className="h-full overflow-y-auto text-base leading-snug whitespace-pre-wrap">
          {d.text || "Double-click to add a note…"}
        </p>
      )}
      {/* Bottom-right resize grip. nodrag so React Flow doesn't also start a
          node-drag when the user grabs it. */}
      <div
        role="separator"
        aria-label="Resize sticky note"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onPointerCancel={onResizePointerUp}
        className="nodrag absolute -right-1 -bottom-1 h-3 w-3 cursor-nwse-resize rounded-sm bg-transparent"
        style={{ touchAction: "none" }}
        data-testid="sticky-resize-grip"
      />
    </div>
  );
}
