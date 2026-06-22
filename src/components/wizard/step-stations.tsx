/**
 * Step 2 — author each station's Inspector General fields end-to-end.
 *
 * VROL-871 — replaces the old name + cycle-ms-only editor with the full
 * General block: label, station type, cycle distribution (via the
 * existing DistributionField primitive), parallel cycles, defect rate,
 * and an optional setup distribution. Stations are reorderable via up/
 * down arrows. The connections step (step 3) is what wires them.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DistributionField } from "@/components/ui/distribution-field";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { constant, type Distribution } from "@/engine";
import { SetupTimeEditor } from "@/editor/inspector-fields";

import { FieldError } from "./field-error";
import type { WizardDraft, WizardStation } from "./wizard-types";

const STATION_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "machine", label: "Machine" },
  { value: "manual", label: "Manual workstation" },
  { value: "qc", label: "QC / inspection" },
  { value: "buffer", label: "Buffer" },
  { value: "transport", label: "Transport" },
  { value: "input", label: "Material input" },
  { value: "output", label: "Output / sink" },
  { value: "packaging", label: "Packaging" },
  { value: "assembly", label: "Assembly" },
  { value: "disassembly", label: "Disassembly" },
  { value: "custom", label: "Custom" },
];

export function StepStations({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const countError = errors?.["count"];
  const updateStation = (idx: number, patch: Partial<WizardStation>) => {
    const next = draft.stations.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    update({ stations: next });
  };
  const addStation = () => {
    const idx = draft.stations.length + 1;
    const id = `s_${Math.random().toString(36).slice(2, 8)}`;
    update({
      stations: [
        ...draft.stations,
        {
          id,
          label: `Station ${String(idx)}`,
          stationType: "machine",
          cycleDistribution: constant(1_000),
          parallelCapacity: 1,
          defectRate: 0,
          setupDistribution: null,
          requiredSkill: "",
          maintenanceWindows: [],
          reworkTargetId: null,
          reworkPassLimit: 3,
        },
      ],
    });
  };
  const removeStation = (idx: number) => {
    if (draft.stations.length <= 1) return;
    const removedId = draft.stations[idx]?.id;
    const stations = draft.stations.filter((_, i) => i !== idx);
    // Cascade: prune connections that touch the removed station.
    const connections = draft.connections.filter(
      (e) => e.sourceId !== removedId && e.targetId !== removedId,
    );
    update({ stations, connections });
  };
  const moveStation = (idx: number, dir: -1 | 1) => {
    const next = [...draft.stations];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[idx];
    const b = next[target];
    if (!a || !b) return;
    next[idx] = b;
    next[target] = a;
    update({ stations: next });
  };
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        For each station, set its type, cycle distribution, parallel cycles, defect rate, and an
        optional setup time. You&rsquo;ll wire them together in the next step.
      </p>
      <div className="space-y-2">
        {draft.stations.map((station, idx) => {
          const labelError = errors?.[`station-${String(idx)}-label`];
          const capacityError = errors?.[`station-${String(idx)}-capacity`];
          const defectError = errors?.[`station-${String(idx)}-defect`];
          const hasError = Boolean(labelError ?? capacityError ?? defectError);
          return (
            <details
              key={station.id}
              open={idx === 0}
              className={`border-border bg-background/40 group rounded-md border ${
                hasError ? "border-sim-down/60" : ""
              }`}
            >
              <summary className="flex cursor-pointer items-center gap-2 p-2">
                <span className="text-muted-foreground bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px]">
                  {idx + 1}
                </span>
                <Input
                  value={station.label}
                  onChange={(e) => {
                    updateStation(idx, { label: e.target.value });
                  }}
                  onClick={(e) => {
                    // Don't toggle the <details> when typing in the label.
                    e.stopPropagation();
                  }}
                  placeholder="Station name"
                  className="h-8 flex-1 text-sm"
                  aria-label={`Station ${String(idx + 1)} name`}
                  aria-invalid={labelError ? true : undefined}
                />
                <span className="text-muted-foreground hidden text-[10px] sm:inline">
                  {labelOfDistribution(station.cycleDistribution)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    moveStation(idx, -1);
                  }}
                  disabled={idx === 0}
                  aria-label={`Move station ${String(idx + 1)} up`}
                  className="h-8 w-8 shrink-0"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    moveStation(idx, 1);
                  }}
                  disabled={idx === draft.stations.length - 1}
                  aria-label={`Move station ${String(idx + 1)} down`}
                  className="h-8 w-8 shrink-0"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={(e) => {
                    e.preventDefault();
                    removeStation(idx);
                  }}
                  disabled={draft.stations.length <= 1}
                  aria-label={`Delete station ${String(idx + 1)}`}
                  className="h-8 w-8 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </summary>
              <div className="space-y-3 border-t p-3">
                <FieldError message={labelError} />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label
                      htmlFor={`station-${String(idx)}-type`}
                      className="text-muted-foreground text-xs font-medium"
                    >
                      Station type
                    </label>
                    <select
                      id={`station-${String(idx)}-type`}
                      value={station.stationType}
                      onChange={(e) => {
                        updateStation(idx, { stationType: e.target.value });
                      }}
                      className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                    >
                      {STATION_TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <NumberField
                    id={`station-${String(idx)}-capacity`}
                    label="Parallel cycles"
                    value={station.parallelCapacity}
                    onChange={(n) => {
                      updateStation(idx, { parallelCapacity: n });
                    }}
                    min={1}
                    max={10}
                    helperText="How many items the station can process in parallel (1–10)."
                  />
                </div>
                <DistributionField
                  label="Cycle distribution (ms)"
                  value={station.cycleDistribution}
                  onChange={(d: Distribution) => {
                    updateStation(idx, { cycleDistribution: d });
                  }}
                />
                <FieldError message={capacityError} />
                <NumberField
                  id={`station-${String(idx)}-defect`}
                  label="Defect rate"
                  value={station.defectRate}
                  onChange={(n) => {
                    updateStation(idx, { defectRate: n });
                  }}
                  min={0}
                  max={1}
                  step={0.01}
                  helperText="Fraction of completed items flagged defective (0–1)."
                />
                <FieldError message={defectError} />
                <SetupTimeEditor
                  value={station.setupDistribution}
                  onChange={(d) => {
                    updateStation(idx, { setupDistribution: d });
                  }}
                />
              </div>
            </details>
          );
        })}
      </div>
      <FieldError message={countError} />
      <Button size="sm" variant="outline" onClick={addStation} className="gap-1">
        <Plus className="h-3.5 w-3.5" />
        Add station
      </Button>
    </div>
  );
}

function labelOfDistribution(d: Distribution): string {
  switch (d.kind) {
    case "constant":
      return `${String(Math.round(d.value))} ms`;
    case "uniform":
      return `${String(Math.round(d.min))}–${String(Math.round(d.max))} ms`;
    case "normal":
      return `μ ${String(Math.round(d.mean))} ± ${String(Math.round(d.stddev))} ms`;
    case "triangular":
      return `${String(Math.round(d.min))}/${String(Math.round(d.mode))}/${String(Math.round(d.max))} ms`;
    case "exponential":
      return `exp ~${String(Math.round(1 / d.rate))} ms`;
    default:
      return d.kind;
  }
}
