/**
 * VROL-913 — per-station quality grades editor.
 *
 * Wraps an editable list of {grade, pct} rows. Add / remove rows; the engine
 * (VROL-882) normalises the weight vector so the user doesn't have to make
 * pct values sum to exactly 1.0. Defaults to empty (engine falls back to
 * {A: 1.0}).
 */

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";

export interface QualityGrade {
  readonly grade: string;
  readonly pct: number;
}

interface Props {
  readonly value: ReadonlyArray<QualityGrade>;
  readonly onChange: (next: ReadonlyArray<QualityGrade>) => void;
}

export function QualityGradesEditor({ value, onChange }: Props) {
  const rows = value;
  const update = (idx: number, patch: Partial<QualityGrade>): void => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const remove = (idx: number): void => {
    onChange(rows.filter((_, i) => i !== idx));
  };
  const add = (): void => {
    // VROL-913 — pre-fill with sensible defaults so the user can see what a
    // valid row looks like. Most QC stations have A/B/scrap; we start with A.
    const usedLabels = new Set(rows.map((r) => r.grade));
    const candidates = ["A", "B", "C", "D"];
    const grade = candidates.find((c) => !usedLabels.has(c)) ?? `Grade ${String(rows.length + 1)}`;
    onChange([...rows, { grade, pct: 0.1 }]);
  };
  const totalPct = rows.reduce((s, r) => s + (Number.isFinite(r.pct) ? r.pct : 0), 0);
  const total = totalPct > 0 ? totalPct : 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-muted-foreground text-xs font-medium">Quality grades</div>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-[11px]">
          No grades set — every completed part counts as grade A. Add rows to split into
          A/B/C/scrap.
        </p>
      ) : (
        <ul className="space-y-1.5" data-testid="quality-grades-editor">
          {rows.map((r, i) => (
            <li
              key={`${String(i)}-${r.grade}`}
              className="border-border bg-card/40 flex items-center gap-2 rounded-md border p-2"
            >
              <Input
                aria-label={`Grade name ${String(i + 1)}`}
                value={r.grade}
                onChange={(e) => {
                  update(i, { grade: e.target.value });
                }}
                className="h-7 w-20 text-xs"
              />
              <NumberField
                id={`quality-grade-${String(i)}-pct`}
                label=""
                value={r.pct}
                min={0}
                max={1}
                step={0.05}
                inputClassName="h-7 w-20 font-mono tabular-nums"
                onChange={(n) => {
                  update(i, { pct: Math.max(0, n) });
                }}
              />
              <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                {Math.round((r.pct / total) * 100)}%
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove grade ${r.grade}`}
                onClick={() => {
                  remove(i);
                }}
                className="ml-auto h-6 w-6"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="outline" size="sm" onClick={add} className="gap-1 self-start">
        <Plus className="h-3 w-3" />
        Add grade
      </Button>
      <p className="text-muted-foreground text-[11px]">
        Engine normalises the weights — sum doesn't need to be exactly 1.0.
      </p>
    </div>
  );
}
