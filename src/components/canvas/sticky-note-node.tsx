/**
 * Sticky note node — Miro-style annotation. Free-text, draggable, no
 * ports (doesn't connect to stations). Double-click to edit, blur to
 * commit. Stored as a normal React-Flow node with `type: "sticky"` so
 * the layout / save flow handles it for free.
 */

import { type NodeProps, useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";

const COLORS = ["yellow", "pink", "blue", "green", "purple"] as const;
type StickyColor = (typeof COLORS)[number];

const COLOR_CLASSES: Record<StickyColor, string> = {
  yellow: "bg-amber-100 text-amber-900 border-amber-300",
  pink: "bg-pink-100 text-pink-900 border-pink-300",
  blue: "bg-blue-100 text-blue-900 border-blue-300",
  green: "bg-emerald-100 text-emerald-900 border-emerald-300",
  purple: "bg-purple-100 text-purple-900 border-purple-300",
};

interface StickyData {
  readonly text?: string;
  readonly color?: StickyColor;
}

export function StickyNoteNode({ data, id, selected }: NodeProps) {
  const d = data as StickyData;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(d.text ?? "");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const flow = useReactFlow();
  const color = d.color ?? "yellow";

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

  const cycleColor = useCallback(() => {
    const idx = COLORS.indexOf(color);
    const nextColor = COLORS[(idx + 1) % COLORS.length] ?? "yellow";
    flow.setNodes((nodes) =>
      nodes.map((n) => {
        if (n.id !== id) return n;
        return { ...n, data: { ...(n.data as object), color: nextColor } };
      }),
    );
  }, [flow, id, color]);

  return (
    <div
      className={`group relative min-h-24 min-w-40 rounded-md border-2 p-3 shadow-md transition-shadow ${
        COLOR_CLASSES[color]
      } ${selected ? "ring-foreground/40 ring-2" : ""}`}
      style={{ fontFamily: "Caveat, 'Comic Sans MS', cursive" }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(d.text ?? "");
        setEditing(true);
      }}
      title="Double-click to edit"
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          cycleColor();
        }}
        aria-label="Change color"
        className="absolute top-1 right-1 h-3 w-3 rounded-full border border-white/40 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "currentColor" }}
      />
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
          className="w-full resize-none bg-transparent text-base leading-snug outline-none"
          style={{ fontFamily: "inherit", minHeight: "5rem" }}
        />
      ) : (
        <p className="text-base leading-snug whitespace-pre-wrap">
          {d.text || "Double-click to add a note…"}
        </p>
      )}
    </div>
  );
}
