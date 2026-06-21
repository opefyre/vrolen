import { Check, Factory, GitBranch, Layers, Square } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FieldError } from "./field-error";
import { SHAPE_OPTIONS, type WizardDraft } from "./wizard-types";

const SHAPE_ICONS: Record<string, LucideIcon> = {
  "bottling-line": Factory,
  "assembly-cell": GitBranch,
  "job-shop": Layers,
  blank: Square,
};

export function StepShape({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const presetError = errors?.["presetId"];
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Pick the shape closest to your line. You can rename and reshape everything later.
      </p>
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Starting shape"
        aria-invalid={presetError ? true : undefined}
      >
        {SHAPE_OPTIONS.map((opt) => {
          const Icon = SHAPE_ICONS[opt.id] ?? Square;
          const isSelected = draft.presetId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                update({ presetId: opt.id, stations: opt.stations });
              }}
              className={`group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all ${
                isSelected
                  ? "border-sim-running bg-sim-running/5 ring-sim-running/30 ring-2"
                  : "border-border bg-card hover:border-foreground/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-md ${
                    isSelected
                      ? "bg-sim-running/15 text-sim-running"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {isSelected ? (
                  <span className="text-sim-running flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
                    <Check className="h-3 w-3" />
                    Selected
                  </span>
                ) : null}
              </div>
              <div className="space-y-0.5">
                <div className="font-heading text-sm font-semibold">{opt.title}</div>
                <div className="text-muted-foreground text-xs leading-relaxed">{opt.blurb}</div>
              </div>
              <div className="text-muted-foreground mt-auto text-[10px]">
                {opt.stations.length} stations
              </div>
            </button>
          );
        })}
      </div>
      <FieldError message={presetError} />
    </div>
  );
}
