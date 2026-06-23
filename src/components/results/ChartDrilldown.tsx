/**
 * VROL-896 — Generic chart drilldown sheet.
 *
 * The post-run result panel renders charts at the panel's natural width
 * (≈ 24rem on the right rail), which is fine as a glanceable summary but
 * unreadable when the user actually wants to interrogate the data. KPI
 * tiles solved this with `KpiDrilldown` — a right-side shadcn Sheet that
 * re-renders the metric at a much larger size with Copy-as-markdown.
 *
 * `ChartDrilldown` is the chart-shaped sibling: same right-side Sheet
 * skeleton, same Copy-as-markdown affordance, but the body is whatever
 * `children` the caller hands in. Chart cards opt in with a small
 * "View details" button in their header.
 *
 * Stays presentational: open / close state and the `markdownData` payload
 * are computed by the caller. Width is set to ~40rem so re-rendered charts
 * have room to breathe; respects the platform Sheet's built-in
 * prefers-reduced-motion handling (no extra entrance animation here).
 */

import { Copy } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "@/lib/toast";

interface ChartDrilldownProps {
  /** Stable identifier for the chart (used as data attribute for tests). */
  readonly chartId: string;
  readonly title: string;
  readonly description?: string;
  /** Markdown table representation of the underlying data, or undefined to hide the Copy button. */
  readonly markdownData?: string;
  readonly open: boolean;
  readonly onClose: () => void;
  /** The bigger chart to render inside the Sheet body. */
  readonly children: ReactNode;
}

async function writeToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Copy failed", { description: "Clipboard not available" });
  }
}

export function ChartDrilldown({
  chartId,
  title,
  description,
  markdownData,
  open,
  onClose,
  children,
}: ChartDrilldownProps) {
  const hasMarkdown = typeof markdownData === "string" && markdownData.length > 0;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        // Drawer-overflow + X-overlap pattern: wide enough for a readable
        // chart (~40rem ≈ 640px), flex column for predictable header /
        // body layout, gap-0 so the body sits flush under the header.
        className="flex w-[40rem] flex-col gap-0 overflow-y-auto sm:max-w-2xl"
        data-chart-drilldown-id={chartId}
      >
        <SheetHeader className="space-y-1 pr-10">
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        {hasMarkdown ? (
          <div className="flex items-center justify-end gap-2 px-4 pb-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => {
                void writeToClipboard(markdownData);
              }}
              aria-label="Copy data as markdown"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden /> Copy markdown
            </Button>
          </div>
        ) : null}
        <div className="px-4 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Small inline "View details" button — visually unobtrusive enough to sit
 * inside a CardHeader's right-hand slot without dominating it. Caller is
 * responsible for the click handler (typically opens a ChartDrilldown).
 */
export function ViewDetailsButton({
  onClick,
  label = "View details",
}: {
  readonly onClick: () => void;
  readonly label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
    >
      {label}
    </button>
  );
}
