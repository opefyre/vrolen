/**
 * Figma-style floating toolbar that appears above a multi-node selection.
 *
 * Renders six alignment buttons + horizontal/vertical distribute + a
 * "Tidy up" grid-snap, plus a quick group/lock convenience. Pure UI —
 * it calls back to the host with intent strings; the host owns nodes
 * + setNodes and applies the transform.
 *
 * Positioned via fixed coords from the host. The host computes the
 * selection bounding box in screen space and passes (left, top) of
 * the top-edge midpoint; the toolbar centers itself on that point.
 */

import {
  AlignCenter,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  Grid3X3,
} from "lucide-react";
import type { ReactNode } from "react";

export type AlignOp =
  | "align-left"
  | "align-h-center"
  | "align-right"
  | "align-top"
  | "align-v-center"
  | "align-bottom"
  | "distribute-h"
  | "distribute-v"
  | "tidy-up";

interface AlignmentToolbarProps {
  readonly anchor: { left: number; top: number } | null;
  readonly selectedCount: number;
  readonly canDistribute: boolean;
  readonly onOp: (op: AlignOp) => void;
}

function Tip({
  label,
  children,
  onClick,
  disabled,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="text-foreground/90 hover:bg-accent flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function AlignmentToolbar({
  anchor,
  selectedCount,
  canDistribute,
  onOp,
}: AlignmentToolbarProps) {
  if (!anchor || selectedCount < 2) return null;
  // Positioned absolute inside the canvas wrapper so it tracks scroll +
  // zoom along with the canvas itself (no fixed-viewport math needed).
  return (
    <div
      role="toolbar"
      aria-label="Align selection"
      className="border-border bg-card pointer-events-auto absolute z-40 flex items-center gap-0.5 rounded-md border p-1 shadow-lg"
      style={{
        left: anchor.left,
        top: anchor.top,
        transform: "translate(-50%, calc(-100% - 8px))",
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <Tip label="Align left edges" onClick={() => onOp("align-left")}>
        <AlignStartVertical className="h-3.5 w-3.5" />
      </Tip>
      <Tip label="Align horizontal centers" onClick={() => onOp("align-h-center")}>
        <AlignCenter className="h-3.5 w-3.5" />
      </Tip>
      <Tip label="Align right edges" onClick={() => onOp("align-right")}>
        <AlignEndVertical className="h-3.5 w-3.5" />
      </Tip>
      <span className="bg-border mx-0.5 h-4 w-px" />
      <Tip label="Align top edges" onClick={() => onOp("align-top")}>
        <AlignStartHorizontal className="h-3.5 w-3.5" />
      </Tip>
      <Tip label="Align vertical centers" onClick={() => onOp("align-v-center")}>
        <AlignCenter className="h-3.5 w-3.5 rotate-90" />
      </Tip>
      <Tip label="Align bottom edges" onClick={() => onOp("align-bottom")}>
        <AlignEndHorizontal className="h-3.5 w-3.5" />
      </Tip>
      <span className="bg-border mx-0.5 h-4 w-px" />
      <Tip
        label="Distribute horizontal spacing"
        disabled={!canDistribute}
        onClick={() => onOp("distribute-h")}
      >
        <AlignHorizontalDistributeCenter className="h-3.5 w-3.5" />
      </Tip>
      <Tip
        label="Distribute vertical spacing"
        disabled={!canDistribute}
        onClick={() => onOp("distribute-v")}
      >
        <AlignVerticalDistributeCenter className="h-3.5 w-3.5" />
      </Tip>
      <span className="bg-border mx-0.5 h-4 w-px" />
      <Tip label="Tidy up (snap to grid)" onClick={() => onOp("tidy-up")}>
        <Grid3X3 className="h-3.5 w-3.5" />
      </Tip>
      <span className="text-muted-foreground ml-1 pr-1.5 text-[10px]">
        {selectedCount} selected
      </span>
    </div>
  );
}
