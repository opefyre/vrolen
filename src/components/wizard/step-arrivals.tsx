import { Input } from "@/components/ui/input";

import { FieldError } from "./field-error";
import type { WizardDraft } from "./wizard-types";

const HORIZON_PRESETS: readonly { label: string; ms: number }[] = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "1 shift (8 h)", ms: 8 * 60 * 60 * 1000 },
  { label: "1 day", ms: 24 * 60 * 60 * 1000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60 * 1000 },
];

export function StepArrivals({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const arrivalsError = errors?.["arrivalsPerMin"];
  const horizonError = errors?.["horizonMs"];
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="wiz-arrivals" className="text-foreground/90 text-sm font-medium">
          How fast does work arrive?
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="wiz-arrivals"
            type="number"
            min={1}
            value={draft.arrivalsPerMin}
            onChange={(e) => {
              // VROL-820 — accept any finite number so the validator can
              // surface the "must be > 0" error. The previous guard
              // silently swallowed zero / negative input.
              const n = Number(e.target.value);
              if (Number.isFinite(n)) update({ arrivalsPerMin: n });
            }}
            className="w-28 text-right font-mono tabular-nums"
            aria-label="Arrivals per minute"
            aria-invalid={arrivalsError ? true : undefined}
          />
          <span className="text-muted-foreground text-sm">items per minute</span>
        </div>
        <p className="text-muted-foreground text-xs">
          Roughly 60/min ≈ one new item every second. The line will queue if your stations
          can&rsquo;t keep up.
        </p>
        <FieldError message={arrivalsError} />
      </div>
      <div className="space-y-2">
        <div className="text-foreground/90 text-sm font-medium">How long should it run?</div>
        <div
          className="flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-label="Run length"
          aria-invalid={horizonError ? true : undefined}
        >
          {HORIZON_PRESETS.map((p) => {
            const isSelected = draft.horizonMs === p.ms;
            return (
              <button
                key={p.label}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  update({ horizonMs: p.ms });
                }}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                  isSelected
                    ? "border-sim-running bg-sim-running/15 text-sim-running"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          We toss the first few minutes so startup quirks don&rsquo;t skew the numbers.
        </p>
        <FieldError message={horizonError} />
      </div>
    </div>
  );
}
