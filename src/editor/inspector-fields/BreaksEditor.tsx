import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface BreakWindow {
  startMs: number;
  endMs: number;
}

interface BreaksEditorProps {
  readonly workerIdx: number;
  readonly breaks: BreakWindow[];
  readonly shiftEndMs: number;
  readonly onChange: (next: BreakWindow[]) => void;
}

/**
 * Inline editor for a worker's break windows (VROL-617). Each row is a
 * start/end ms pair plus a trash button. End must be > start AND ≤ shiftEndMs;
 * invalid values show an inline error and don't persist. Empty list → the
 * caller drops the breaks field entirely so the engine treats the worker as
 * pre-VROL-616 / no-breaks.
 */
export function BreaksEditor({ workerIdx, breaks, shiftEndMs, onChange }: BreaksEditorProps) {
  return (
    <div className="border-border space-y-1.5 rounded-md border border-dashed p-2">
      <div className="text-muted-foreground flex items-center justify-between text-xs font-medium">
        <span>Breaks (ms)</span>
        {breaks.length > 0 ? (
          <span className="bg-muted rounded-full px-1.5 py-0.5">
            {breaks.length} break{breaks.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {breaks.length === 0 ? (
        <p className="text-muted-foreground text-xs">No breaks — full shift available.</p>
      ) : null}
      {breaks.map((brk, bIdx) => {
        const invalid = brk.endMs <= brk.startMs;
        const outOfShift = brk.endMs > shiftEndMs;
        return (
          <div key={bIdx} className="flex items-center gap-1.5">
            <Input
              id={`rs-worker-${String(workerIdx)}-break-${String(bIdx)}-start`}
              type="number"
              min={0}
              step={500}
              value={brk.startMs}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (!Number.isFinite(n) || n < 0) return;
                onChange(breaks.map((b, i) => (i === bIdx ? { ...b, startMs: n } : b)));
              }}
              className="w-24 font-mono text-xs tabular-nums"
              aria-label={`Break ${String(bIdx + 1)} start`}
            />
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              id={`rs-worker-${String(workerIdx)}-break-${String(bIdx)}-end`}
              type="number"
              min={0}
              step={500}
              value={brk.endMs}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (!Number.isFinite(n) || n < 0) return;
                onChange(breaks.map((b, i) => (i === bIdx ? { ...b, endMs: n } : b)));
              }}
              className="w-24 font-mono text-xs tabular-nums"
              aria-label={`Break ${String(bIdx + 1)} end`}
            />
            {invalid ? (
              <span className="text-sim-down-foreground text-[10px]">end ≤ start</span>
            ) : outOfShift ? (
              <span className="text-sim-setup-foreground text-[10px]">past shift end</span>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label={`Remove break ${String(bIdx + 1)}`}
              onClick={() => {
                onChange(breaks.filter((_, i) => i !== bIdx));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          const lastEnd = breaks.length > 0 ? (breaks[breaks.length - 1]?.endMs ?? 0) : 0;
          const start = Math.max(0, lastEnd);
          const end = Math.min(shiftEndMs, start + 5_000);
          onChange([...breaks, { startMs: start, endMs: end }]);
        }}
      >
        + Add break
      </Button>
    </div>
  );
}
