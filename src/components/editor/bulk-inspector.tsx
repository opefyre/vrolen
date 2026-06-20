/**
 * VROL-663 — bulk-edit Inspector. Shown when 2+ stations are selected.
 * Edits apply immediately to all selected nodes. Limited to fields where
 * "bulk apply" makes sense — capacity, defect rate. Per-station-reference
 * fields like rework target and cycle distribution are deliberately not
 * here.
 */

import type { Node } from "@xyflow/react";

import { NumberField } from "@/components/ui/number-field";

interface BulkInspectorProps {
  readonly selectedNodes: readonly Node[];
  readonly onPatch: (patch: Record<string, unknown>) => void;
}

export function BulkInspector({ selectedNodes, onPatch }: BulkInspectorProps) {
  const count = selectedNodes.length;
  // Show the value common to all selected; if mixed, show 0 (capacity 1).
  const commonNumber = (key: string, fallback: number): number => {
    const first = (selectedNodes[0]?.data as Record<string, unknown> | undefined)?.[key];
    const firstNum = typeof first === "number" ? first : fallback;
    const all = selectedNodes.every(
      (n) => ((n.data as Record<string, unknown>)[key] ?? fallback) === firstNum,
    );
    return all ? firstNum : fallback;
  };
  const capacity = commonNumber("capacity", 1);
  const defectRate = commonNumber("defectRate", 0);

  return (
    <div className="space-y-3" data-testid="bulk-inspector">
      <div className="text-muted-foreground text-xs">
        <strong className="text-foreground">{count} stations</strong> selected. Edits apply to all.
      </div>
      <NumberField
        id="bulk-capacity"
        label="Parallel cycles"
        value={capacity}
        min={1}
        max={10}
        step={1}
        helperText="Number of parts each station processes simultaneously."
        onChange={(n) => {
          const v = Math.max(1, Math.min(10, Math.floor(n)));
          onPatch({ capacity: v === 1 ? undefined : v });
        }}
      />
      <NumberField
        id="bulk-defect"
        label="Defect rate"
        value={defectRate}
        min={0}
        max={1}
        step={0.01}
        helperText="Probability of defect per part (0–1)."
        inputClassName="font-mono tabular-nums w-32"
        onChange={(n) => {
          onPatch({ defectRate: n });
        }}
      />
    </div>
  );
}
