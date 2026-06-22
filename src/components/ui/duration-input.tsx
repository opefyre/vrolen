import { useCallback, useState } from "react";

import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * VROL-822 — unit-aware duration editor (ms / s / min / h).
 *
 * Replaces the raw "type milliseconds" inputs scattered across the inspector,
 * the run-settings drawer, and the wizard. The model is always milliseconds —
 * the displayed unit is local UI state, so switching the unit selector
 * re-renders the same underlying ms in the new unit without firing
 * `onChangeMs`.
 *
 * Usage:
 * ```tsx
 * <DurationInput
 *   id="horizon"
 *   label="Horizon"
 *   valueMs={settings.horizonMs}
 *   onChangeMs={(ms) => setSettings({ ...settings, horizonMs: ms })}
 *   defaultUnit="min"
 *   min={1000}
 * />
 * ```
 *
 * Tests live alongside in `duration-input.test.tsx`.
 *
 * FIXME(VROL-822 follow-up): the main agent should swap the three high-value
 * raw-ms inputs onto this component once `EditorPage.tsx` is unblocked.
 * Specifically:
 *   1. `src/routes/EditorPage.tsx` — horizon input in the run-settings sheet.
 *      `<DurationInput valueMs={settings.horizonMs}
 *         onChangeMs={(ms) => setSettings({ ...settings, horizonMs: ms })}
 *         label="Horizon" defaultUnit="min" min={1000} />`
 *   2. `src/routes/EditorPage.tsx` — warmup input in the same sheet.
 *      `<DurationInput valueMs={settings.warmupMs}
 *         onChangeMs={(ms) => setSettings({ ...settings, warmupMs: ms })}
 *         label="Warmup window" defaultUnit="s" min={0} />`
 *   3. `src/routes/EditorPage.tsx` — breakdowns MTBF + MTTR inputs in the
 *      inspector (search for `mtbfMs` / `mttrMs`). Both `defaultUnit="min"`.
 */

export type DurationUnit = "ms" | "s" | "min" | "h";

interface DurationInputProps {
  readonly valueMs: number;
  readonly onChangeMs: (ms: number) => void;
  /**
   * Initial unit for the selector. When omitted, picks the friendliest unit
   * from the magnitude of `valueMs` (see {@link pickDefaultUnit}).
   */
  readonly defaultUnit?: DurationUnit;
  readonly id?: string;
  readonly label?: string;
  /** Optional bounds, expressed in ms (the model unit). */
  readonly min?: number;
  readonly max?: number;
  /**
   * Step for the underlying NumberField, expressed in the *displayed unit*.
   * Defaults to 1 in the current unit, except for ms where it defaults to
   * the spec's `step` if supplied. If omitted, `1` is used.
   */
  readonly step?: number;
  readonly helperText?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

const UNIT_TO_MS: Record<DurationUnit, number> = {
  ms: 1,
  s: 1000,
  min: 60_000,
  h: 3_600_000,
};

const UNIT_LABEL: Record<DurationUnit, string> = {
  ms: "ms",
  s: "s",
  min: "min",
  h: "h",
};

const UNIT_ORDER: ReadonlyArray<DurationUnit> = ["ms", "s", "min", "h"];

/**
 * Choose the friendliest unit for a given ms magnitude. Mirrors the rule the
 * spec describes — ms <1s, s <1min, min <1h, else h.
 */
export function pickDefaultUnit(valueMs: number): DurationUnit {
  const abs = Math.abs(valueMs);
  if (abs < 1000) return "ms";
  if (abs < 60_000) return "s";
  if (abs < 3_600_000) return "min";
  return "h";
}

/**
 * Convert a ms magnitude into the displayed unit. The result is rounded to
 * 1 decimal for non-ms units (so 30000ms → 30, not 30.0). ms is returned
 * as an integer.
 */
export function msToUnit(valueMs: number, unit: DurationUnit): number {
  if (unit === "ms") return Math.round(valueMs);
  const raw = valueMs / UNIT_TO_MS[unit];
  return Math.round(raw * 10) / 10;
}

/** Convert a displayed value (in the given unit) back to ms. */
export function unitToMs(displayed: number, unit: DurationUnit): number {
  if (unit === "ms") return Math.round(displayed);
  return Math.round(displayed * UNIT_TO_MS[unit]);
}

export function DurationInput({
  valueMs,
  onChangeMs,
  defaultUnit,
  id,
  label,
  min,
  max,
  step,
  helperText,
  disabled,
  className,
}: DurationInputProps) {
  const [unit, setUnit] = useState<DurationUnit>(() => defaultUnit ?? pickDefaultUnit(valueMs));

  // The display value derives from the prop and the current unit, so a
  // unit switch re-renders the same underlying ms in the new unit without
  // firing onChangeMs.
  const displayed = msToUnit(valueMs, unit);

  const handleNumberChange = useCallback(
    (next: number) => {
      const ms = unitToMs(next, unit);
      // Clamp against the ms-domain min/max so users can't bypass the bound
      // by switching units.
      let clamped = ms;
      if (typeof min === "number" && clamped < min) clamped = min;
      if (typeof max === "number" && clamped > max) clamped = max;
      if (clamped !== valueMs) onChangeMs(clamped);
    },
    [unit, min, max, valueMs, onChangeMs],
  );

  const handleUnitChange = useCallback((next: unknown) => {
    if (typeof next !== "string") return;
    if (next === "ms" || next === "s" || next === "min" || next === "h") {
      setUnit(next);
    }
  }, []);

  // Display-unit bounds for the NumberField. ms-domain bounds are still
  // enforced inside handleNumberChange — these are just the input's UX
  // affordances so up/down arrows respect the limits.
  const displayMin = typeof min === "number" ? msToUnit(min, unit) : undefined;
  const displayMax = typeof max === "number" ? msToUnit(max, unit) : undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-end gap-2">
        <NumberField
          id={id}
          label={label}
          value={displayed}
          onChange={handleNumberChange}
          min={displayMin}
          max={displayMax}
          step={step ?? (unit === "ms" ? 1 : 0.1)}
          ariaLabel={label}
          disabled={disabled}
          className="flex-1"
          inputClassName="font-mono tabular-nums"
        />
        <Select value={unit} onValueChange={handleUnitChange} disabled={disabled}>
          <SelectTrigger
            size="sm"
            aria-label={label ? `${label} unit` : "Duration unit"}
            className="h-8 shrink-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNIT_ORDER.map((u) => (
              <SelectItem key={u} value={u}>
                {UNIT_LABEL[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {helperText ? <p className="text-muted-foreground text-[11px]">{helperText}</p> : null}
    </div>
  );
}
