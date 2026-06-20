/**
 * Lucidchart-style ghost quick-add buttons.
 *
 * When exactly one station is selected, four faint ghost tiles appear
 * floating just to the RIGHT of that station. Each ghost represents a
 * common next-station type (Machine, Buffer, QC, Output). Click any
 * ghost to instantly create that station AND wire it up to the
 * selected node — no drag, no menu.
 *
 * Positioned inside the canvas wrapper using wrapper-relative coords so
 * the host can mount it next to the ReactFlow viewport.
 */

import { Boxes, ConciergeBell, Factory, PackageCheck, Plus, Wrench } from "lucide-react";
import type { ReactNode } from "react";

export type QuickAddStationType = "machine" | "buffer" | "qc" | "output";

const QUICK_ADD_OPTIONS: readonly {
  readonly stationType: QuickAddStationType;
  readonly label: string;
  readonly icon: ReactNode;
}[] = [
  { stationType: "machine", label: "Machine", icon: <Factory className="h-3.5 w-3.5" /> },
  { stationType: "buffer", label: "Buffer", icon: <Boxes className="h-3.5 w-3.5" /> },
  { stationType: "qc", label: "QC", icon: <PackageCheck className="h-3.5 w-3.5" /> },
  { stationType: "output", label: "Output", icon: <Wrench className="h-3.5 w-3.5" /> },
];

interface QuickAddGhostsProps {
  /** Wrapper-relative position of the selected node's right-mid handle. */
  readonly anchor: { left: number; top: number } | null;
  readonly onAdd: (stationType: QuickAddStationType) => void;
}

export function QuickAddGhosts({ anchor, onAdd }: QuickAddGhostsProps) {
  if (!anchor) return null;
  return (
    <div
      data-testid="quick-add-ghosts"
      className="pointer-events-none absolute z-30"
      style={{ left: anchor.left, top: anchor.top, transform: "translate(20px, -50%)" }}
    >
      <div className="flex items-center gap-1">
        <ConciergeBell className="text-muted-foreground/40 h-3 w-3" aria-hidden />
        <div className="flex flex-col gap-1">
          {QUICK_ADD_OPTIONS.map((opt) => (
            <button
              key={opt.stationType}
              type="button"
              onClick={() => {
                onAdd(opt.stationType);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              title={`Add ${opt.label}, connected to this station`}
              className="border-border bg-card/80 text-muted-foreground hover:border-foreground/40 hover:bg-card hover:text-foreground pointer-events-auto flex h-7 items-center gap-1.5 rounded-md border-2 border-dashed px-2 text-[11px] font-medium opacity-50 shadow-sm transition-all hover:opacity-100"
            >
              <Plus className="h-3 w-3" aria-hidden />
              <span className="flex h-4 w-4 items-center justify-center">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
