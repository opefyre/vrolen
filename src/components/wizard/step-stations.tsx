import { ArrowRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FieldError } from "./field-error";
import type { WizardDraft, WizardStation } from "./wizard-types";

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
    update({
      stations: [
        ...draft.stations,
        {
          id: `s${String(Date.now())}`,
          label: `Station ${String(idx)}`,
          stationType: "machine",
          cycleMs: 1_000,
        },
      ],
    });
  };
  const removeStation = (idx: number) => {
    if (draft.stations.length <= 1) return;
    update({ stations: draft.stations.filter((_, i) => i !== idx) });
  };
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Rename each station and tell us how long one item spends there. Average is fine — you can
        switch to a real distribution later.
      </p>
      <div className="space-y-2">
        {draft.stations.map((station, idx) => {
          const labelError = errors?.[`station-${String(idx)}-label`];
          const cycleError = errors?.[`station-${String(idx)}-cycle`];
          return (
            <div
              key={station.id}
              className={`border-border bg-background/40 rounded-md border p-2 ${
                labelError || cycleError ? "border-sim-down/60" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px]">
                  {idx + 1}
                </span>
                <Input
                  value={station.label}
                  onChange={(e) => {
                    updateStation(idx, { label: e.target.value });
                  }}
                  placeholder="Station name"
                  className="h-8 text-sm"
                  aria-label={`Station ${String(idx + 1)} name`}
                  aria-invalid={labelError ? true : undefined}
                />
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">≈</span>
                  <Input
                    type="number"
                    min={1}
                    value={Math.round(station.cycleMs)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      // VROL-820 — accept the parsed number even when 0 / NaN
                      // so the validator can flag it. Previously the guard
                      // here swallowed invalid input silently, hiding the bug.
                      const n = Number(raw);
                      if (Number.isFinite(n)) updateStation(idx, { cycleMs: n });
                    }}
                    className="h-8 w-20 text-right font-mono tabular-nums"
                    aria-label={`Station ${String(idx + 1)} cycle ms`}
                    aria-invalid={cycleError ? true : undefined}
                  />
                  <span className="text-muted-foreground text-xs">ms</span>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    removeStation(idx);
                  }}
                  disabled={draft.stations.length <= 1}
                  aria-label={`Delete station ${String(idx + 1)}`}
                  className="h-8 w-8 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {idx < draft.stations.length - 1 ? (
                  <ArrowRight
                    className="text-muted-foreground/40 h-3.5 w-3.5 shrink-0"
                    aria-hidden
                  />
                ) : null}
              </div>
              <FieldError message={labelError} />
              <FieldError message={cycleError} />
            </div>
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
