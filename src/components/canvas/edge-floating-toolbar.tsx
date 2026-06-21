/**
 * Miro-style floating toolbar for the selected edge (Sprint 84).
 *
 * When the user selects exactly one edge, this floats above the canvas
 * at the edge's midpoint (in screen coords, so it stays fixed during
 * pan/zoom). It exposes line shape (orthogonal / curve / straight),
 * dashed toggle, arrow-direction toggle, and color picker.
 *
 * All state lives on edge.data so it survives serialization, undo, and
 * scenario save/load.
 */

import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Minus,
  Slash,
  Spline,
  Waypoints,
} from "lucide-react";
import { type CSSProperties, useMemo } from "react";

import type { EdgeArrowMode, EdgeLineShape } from "@/routes/AnimatedEdge";

export interface EdgeToolbarState {
  readonly lineShape: EdgeLineShape;
  readonly lineDash: boolean;
  readonly arrowMode: EdgeArrowMode;
  readonly strokeColor: string | undefined;
}

interface EdgeFloatingToolbarProps {
  /**
   * Anchor in viewport (screen) px. The toolbar centers horizontally on
   * anchor.x and floats ABOVE anchor.y by its own height + gap — pass the
   * topmost endpoint y so the toolbar never overlaps the edge line.
   */
  readonly anchor: { x: number; y: number } | null;
  readonly state: EdgeToolbarState;
  readonly onChange: (next: Partial<EdgeToolbarState>) => void;
}

const COLOR_SWATCHES: { name: string; value: string }[] = [
  { name: "Default", value: "var(--foreground)" },
  { name: "Green", value: "var(--sim-running)" },
  { name: "Orange", value: "var(--sim-setup)" },
  { name: "Red", value: "var(--sim-down)" },
  { name: "Yellow", value: "var(--sim-blocked)" },
];

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="bg-border h-5 w-px shrink-0" aria-hidden />;
}

export function EdgeFloatingToolbar({ anchor, state, onChange }: EdgeFloatingToolbarProps) {
  // Position so the toolbar sits above the anchor (with a comfortable gap)
  // and is clamped to the viewport so it never escapes off-screen.
  const style = useMemo<CSSProperties>(() => {
    if (!anchor) return { display: "none" };
    const w = 320;
    const h = 44;
    const GAP = 16;
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const left = Math.min(Math.max(8, anchor.x - w / 2), Math.max(8, vw - w - 8));
    const top = Math.min(Math.max(8, anchor.y - h - GAP), Math.max(8, vh - h - 8));
    return { position: "fixed", left, top, width: w, zIndex: 40 };
  }, [anchor]);

  if (!anchor) return null;

  return (
    <div
      role="toolbar"
      aria-label="Edge style"
      style={style}
      className="border-border bg-popover/95 flex items-center gap-1 rounded-xl border p-1 shadow-xl ring-1 ring-black/5 backdrop-blur-sm"
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {/* Line shape */}
      <ToolButton
        active={state.lineShape === "smoothstep"}
        onClick={() => onChange({ lineShape: "smoothstep" })}
        title="Orthogonal (rounded corners)"
      >
        <Waypoints className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={state.lineShape === "bezier"}
        onClick={() => onChange({ lineShape: "bezier" })}
        title="Curve"
      >
        <Spline className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={state.lineShape === "straight"}
        onClick={() => onChange({ lineShape: "straight" })}
        title="Straight"
      >
        <Slash className="h-3.5 w-3.5" />
      </ToolButton>
      <Divider />
      {/* Dashed */}
      <ToolButton
        active={!state.lineDash}
        onClick={() => onChange({ lineDash: false })}
        title="Solid line"
      >
        <Minus className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={state.lineDash}
        onClick={() => onChange({ lineDash: true })}
        title="Dashed line"
      >
        <Minus className="h-3.5 w-3.5" style={{ strokeDasharray: "3 2" }} />
      </ToolButton>
      <Divider />
      {/* Arrow direction */}
      <ToolButton
        active={state.arrowMode === "end"}
        onClick={() => onChange({ arrowMode: "end" })}
        title="Arrow at end"
      >
        <ArrowRight className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={state.arrowMode === "start"}
        onClick={() => onChange({ arrowMode: "start" })}
        title="Arrow at start"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={state.arrowMode === "both"}
        onClick={() => onChange({ arrowMode: "both" })}
        title="Bidirectional"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
      </ToolButton>
      <ToolButton
        active={state.arrowMode === "none"}
        onClick={() => onChange({ arrowMode: "none" })}
        title="No arrow"
      >
        <Minus className="h-3.5 w-3.5" />
      </ToolButton>
      <Divider />
      {/* Color swatches */}
      <div className="flex items-center gap-1 px-1">
        {COLOR_SWATCHES.map((sw) => {
          const isActive =
            (sw.value === "var(--foreground)" && !state.strokeColor) ||
            state.strokeColor === sw.value;
          return (
            <button
              key={sw.name}
              type="button"
              onClick={() =>
                onChange({
                  strokeColor: sw.value === "var(--foreground)" ? undefined : sw.value,
                })
              }
              title={sw.name}
              aria-label={`Color: ${sw.name}`}
              aria-pressed={isActive}
              className={[
                "h-4 w-4 rounded-full border transition-transform",
                isActive ? "border-foreground scale-125" : "border-border hover:scale-110",
              ].join(" ")}
              style={{ background: sw.value }}
            />
          );
        })}
      </div>
    </div>
  );
}
