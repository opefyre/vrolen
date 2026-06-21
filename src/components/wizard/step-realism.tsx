import { Check, Flame, Sparkles, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { FieldError } from "./field-error";
import type { RealismLevel, WizardDraft } from "./wizard-types";

const OPTIONS: readonly {
  readonly id: RealismLevel;
  readonly title: string;
  readonly icon: LucideIcon;
  readonly blurb: string;
  readonly details: readonly string[];
}[] = [
  {
    id: "simple",
    title: "Keep it simple",
    icon: Sparkles,
    blurb: "Perfect line. Stations never break, nothing scraps.",
    details: ["No breakdowns", "0% defect rate", "Use to sanity-check throughput math"],
  },
  {
    id: "realistic",
    title: "Realistic",
    icon: Wrench,
    blurb: "What most lines actually look like.",
    details: ["MTBF / MTTR = 30 min / 5 min", "2% defect rate", "Light variability on cycle times"],
  },
  {
    id: "stress",
    title: "Stress test",
    icon: Flame,
    blurb: "Worst case. Find out where the line collapses.",
    details: ["MTBF / MTTR = 10 min / 8 min", "5% defect rate", "Heavy variability"],
  },
];

export function StepRealism({
  draft,
  setRealism,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly setRealism: (level: RealismLevel) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const realismError = errors?.["realism"];
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        You&rsquo;re picking how messy the world is. Realistic is the default for production lines.
      </p>
      <div
        className="space-y-2"
        role="radiogroup"
        aria-label="Realism level"
        aria-invalid={realismError ? true : undefined}
      >
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isSelected = draft.realism === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => {
                setRealism(opt.id);
              }}
              className={`group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                isSelected
                  ? "border-sim-running bg-sim-running/5 ring-sim-running/30 ring-2"
                  : "border-border bg-card hover:border-foreground/30"
              }`}
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                  isSelected
                    ? "bg-sim-running/15 text-sim-running"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-heading text-sm font-semibold">{opt.title}</span>
                  {isSelected ? (
                    <span className="text-sim-running flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
                      <Check className="h-3 w-3" />
                      Selected
                    </span>
                  ) : null}
                </div>
                <div className="text-muted-foreground text-xs leading-relaxed">{opt.blurb}</div>
                <ul className="text-muted-foreground mt-1 space-y-0.5 text-[11px]">
                  {opt.details.map((d) => (
                    <li
                      key={d}
                      className="before:bg-muted-foreground/40 flex items-center gap-1.5 before:h-1 before:w-1 before:rounded-full"
                    >
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            </button>
          );
        })}
      </div>
      <FieldError message={realismError} />
    </div>
  );
}
