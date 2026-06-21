import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MaintenanceWindow {
  startMs: number;
  endMs: number;
}

interface MaintenanceWindowsEditorProps {
  readonly value: readonly MaintenanceWindow[];
  readonly onChange: (next: MaintenanceWindow[]) => void;
}

export function MaintenanceWindowsEditor({ value, onChange }: MaintenanceWindowsEditorProps) {
  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-3">
      <div className="text-xs font-medium">Planned maintenance windows</div>
      {value.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No maintenance planned. Add a window with explicit start + end (ms).
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((w, idx) => (
            <li key={idx} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`maint-${String(idx)}-start`}
                  className="text-muted-foreground text-xs font-medium"
                >
                  Start (ms)
                </label>
                <Input
                  id={`maint-${String(idx)}-start`}
                  type="number"
                  min={0}
                  step={1000}
                  value={w.startMs}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) {
                      onChange(
                        value.map((entry, i) =>
                          i === idx ? { ...entry, startMs: Math.floor(n) } : entry,
                        ),
                      );
                    }
                  }}
                  className="font-mono tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`maint-${String(idx)}-end`}
                  className="text-muted-foreground text-xs font-medium"
                >
                  End (ms)
                </label>
                <Input
                  id={`maint-${String(idx)}-end`}
                  type="number"
                  min={w.startMs + 1}
                  step={1000}
                  value={w.endMs}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > w.startMs) {
                      onChange(
                        value.map((entry, i) =>
                          i === idx ? { ...entry, endMs: Math.floor(n) } : entry,
                        ),
                      );
                    }
                  }}
                  className="font-mono tabular-nums"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove window ${String(idx + 1)}`}
                onClick={() => {
                  onChange(value.filter((_, i) => i !== idx));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          const last = value[value.length - 1];
          const start = last ? last.endMs + 5_000 : 10_000;
          onChange([...value, { startMs: start, endMs: start + 5_000 }]);
        }}
      >
        Add window
      </Button>
    </div>
  );
}
