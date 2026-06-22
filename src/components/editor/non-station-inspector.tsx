/**
 * Inspector for sticky notes + section frames.
 *
 * Stations carry production config (cycle distribution, defect rate,
 * capacity, breakdowns, recipes, skills…). Sticky notes and section
 * frames are visual annotations and should NEVER see that UI — it
 * was confusing users into thinking their sticky note had a cycle
 * time. This component renders ONLY the fields that apply:
 *
 *   • Sticky note → text + color swatch
 *   • Section frame → label + color swatch + size readout
 *
 * No "production" or "recipe" sections, no defect rate, no Run-time
 * fields. Sticky notes can be edited inline on the canvas too (double-
 * click), but having a side panel makes color changes one-click.
 */

import type { Node } from "@xyflow/react";
import { StickyNote, Square, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const STICKY_SWATCHES: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly bg: string;
}> = [
  { id: "yellow", label: "Yellow", bg: "bg-sim-setup/40 border-sim-setup/60" },
  { id: "blue", label: "Blue", bg: "bg-sim-running/30 border-sim-running/60" },
  { id: "rose", label: "Rose", bg: "bg-sim-down/25 border-sim-down/60" },
  { id: "gray", label: "Gray", bg: "bg-muted border-border" },
];

const FRAME_SWATCHES: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly bg: string;
}> = [
  { id: "blue", label: "Blue", bg: "bg-sim-running/20 border-sim-running/60" },
  { id: "amber", label: "Amber", bg: "bg-sim-setup/25 border-sim-setup/60" },
  { id: "rose", label: "Rose", bg: "bg-sim-down/20 border-sim-down/60" },
  { id: "gray", label: "Gray", bg: "bg-muted border-border" },
];

interface Props {
  readonly node: Node;
  readonly onClose: () => void;
  readonly onPatch: (patch: Record<string, unknown>) => void;
  readonly scenarioName: string | null;
}

export function NonStationInspector({ node, onClose, onPatch, scenarioName }: Props) {
  const isFrame = node.type === "frame";
  const isSticky = node.type === "sticky";
  if (!isFrame && !isSticky) return null;

  const data = (node.data ?? {}) as {
    label?: unknown;
    text?: unknown;
    color?: unknown;
    width?: unknown;
    height?: unknown;
  };
  const label = typeof data.label === "string" ? data.label : "";
  const text = typeof data.text === "string" ? data.text : "";
  const color = typeof data.color === "string" ? data.color : isFrame ? "blue" : "yellow";
  const swatches = isFrame ? FRAME_SWATCHES : STICKY_SWATCHES;
  const TypeIcon = isFrame ? Square : StickyNote;
  const typeLabel = isFrame ? "Section frame" : "Sticky note";

  return (
    <Card className="overflow-y-auto">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading flex items-center gap-1.5 text-base">
            <TypeIcon className="text-muted-foreground h-4 w-4" aria-hidden />
            <span>{typeLabel}</span>
          </CardTitle>
          <CardDescription className="text-xs">
            <span className="text-foreground/70">{scenarioName ?? "Untitled"}</span>
            <span className="mx-1">›</span>
            <span className="font-medium">
              {label || (isFrame ? "Section" : text.slice(0, 40) || "Sticky")}
            </span>
            <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">annotation</span>
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close inspector"
          className="-mt-1"
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isFrame ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="frame-label" className="text-muted-foreground text-xs font-medium">
              Label
            </label>
            <Input
              id="frame-label"
              type="text"
              value={label}
              placeholder="Section"
              onChange={(e) => {
                onPatch({ label: e.target.value });
              }}
            />
            <p className="text-muted-foreground text-[11px]">
              Shown in the top-left corner of the frame. Frames are visual only and don't
              participate in the simulation graph.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <label htmlFor="sticky-text" className="text-muted-foreground text-xs font-medium">
              Text
            </label>
            <textarea
              id="sticky-text"
              value={text}
              placeholder="Double-click the note on the canvas to edit inline, or type here."
              rows={4}
              onChange={(e) => {
                onPatch({ text: e.target.value });
              }}
              className="border-input bg-background focus-visible:ring-ring resize-none rounded-md border px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground text-xs font-medium">Color</span>
          <div className="flex flex-wrap gap-1.5">
            {swatches.map((s) => {
              const active = s.id === color;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-label={`${s.label} color`}
                  aria-pressed={active}
                  onClick={() => {
                    onPatch({ color: s.id });
                  }}
                  title={s.label}
                  className={`h-7 w-7 rounded-md border-2 ${s.bg} ${
                    active
                      ? "ring-foreground ring-2 ring-offset-2"
                      : "hover:ring-foreground/40 hover:ring-2 hover:ring-offset-1"
                  }`}
                />
              );
            })}
          </div>
        </div>
        {isFrame && typeof data.width === "number" && typeof data.height === "number" ? (
          <div className="text-muted-foreground border-border space-y-0.5 border-t pt-3 text-[11px]">
            <div>
              Size:{" "}
              <span className="text-foreground font-mono tabular-nums">
                {String(Math.round(data.width))} × {String(Math.round(data.height))} px
              </span>
            </div>
            <div>Drag any of the 8 grips to resize.</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
