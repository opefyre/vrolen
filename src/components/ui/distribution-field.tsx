/**
 * VROL-289 — distribution picker primitive.
 *
 * Promoted out of EditorPage's inline DistributionEditor. Same behavior +
 * three additions per the VROL-289 AC:
 *   - Live histogram preview (sample 1000 with a stable PRNG, bin, draw)
 *   - Preset shortcut chips ("fixed 60s", "60s ± 20%", etc.)
 *   - Reusable in places beyond the Inspector
 */

import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import { type Distribution, meanOf, SeededPrng, sample } from "@/engine";

interface DistributionFieldProps {
  readonly value: Distribution;
  readonly onChange: (next: Distribution) => void;
  readonly label?: string;
  readonly id?: string;
}

interface PresetChip {
  readonly label: string;
  readonly build: (meanGuess: number) => Distribution;
}

// Presets are computed off the current mean so the user can iterate
// without re-typing every value. "Fixed 60s" snaps to that exact value
// the first time; the user can then drag it around.
const PRESETS: readonly PresetChip[] = [
  { label: "Fixed", build: (m) => ({ kind: "constant", value: Math.max(1, Math.round(m)) }) },
  {
    label: "± 10%",
    build: (m) => ({
      kind: "uniform",
      min: Math.max(1, Math.round(m * 0.9)),
      max: Math.max(2, Math.round(m * 1.1)),
    }),
  },
  {
    label: "± 30%",
    build: (m) => ({
      kind: "uniform",
      min: Math.max(1, Math.round(m * 0.7)),
      max: Math.max(2, Math.round(m * 1.3)),
    }),
  },
  {
    label: "Normal",
    build: (m) => ({
      kind: "normal",
      mean: Math.max(1, Math.round(m)),
      stddev: Math.max(1, Math.round(m * 0.15)),
    }),
  },
  {
    label: "Long tail",
    build: (m) => ({ kind: "exponential", rate: 1 / Math.max(1, m) }),
  },
];

const HIST_W = 240;
const HIST_H = 48;
const HIST_BINS = 24;
const HIST_SAMPLES = 1000;

function buildHistogram(d: Distribution): {
  bars: { x: number; h: number }[];
  labelLo: number;
  labelHi: number;
} {
  // Deterministic preview — fresh seed each render means the SVG is stable.
  const prng = new SeededPrng(0xc0ffee);
  const samples: number[] = [];
  for (let i = 0; i < HIST_SAMPLES; i++) {
    samples.push(sample(d, prng, { min: 0 }));
  }
  if (samples.length === 0) return { bars: [], labelLo: 0, labelHi: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of samples) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) hi = lo + 1; // degenerate constant
  const binWidth = (hi - lo) / HIST_BINS;
  const counts = new Array<number>(HIST_BINS).fill(0);
  for (const v of samples) {
    const idx = Math.min(HIST_BINS - 1, Math.floor((v - lo) / binWidth));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const maxCount = Math.max(1, ...counts);
  const barW = HIST_W / HIST_BINS;
  const bars = counts.map((c, i) => ({
    x: i * barW,
    h: (c / maxCount) * HIST_H,
  }));
  return { bars, labelLo: lo, labelHi: hi };
}

function meanGuessOf(d: Distribution): number {
  switch (d.kind) {
    case "constant":
      return d.value;
    case "uniform":
      return (d.min + d.max) / 2;
    case "normal":
      return d.mean;
    case "triangular":
      return (d.min + d.mode + d.max) / 3;
    case "exponential":
      return 1 / d.rate;
  }
}

export function DistributionField({ value, onChange, label, id }: DistributionFieldProps) {
  const histogram = useMemo(() => buildHistogram(value), [value]);

  const numberField = (
    fieldLabel: string,
    fieldId: string,
    fieldValue: number,
    setter: (n: number) => void,
    extras: { min?: number; max?: number; step?: number } = {},
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={fieldId} className="text-muted-foreground text-xs font-medium">
        {fieldLabel}
      </label>
      <Input
        id={fieldId}
        type="number"
        min={extras.min}
        max={extras.max}
        step={extras.step ?? 1}
        value={fieldValue}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setter(n);
        }}
        className="font-mono tabular-nums"
      />
    </div>
  );

  const handleKindChange = (kind: Distribution["kind"]): void => {
    const m = meanGuessOf(value);
    switch (kind) {
      case "constant":
        onChange({ kind: "constant", value: Math.max(1, Math.round(m)) });
        break;
      case "uniform":
        onChange({
          kind: "uniform",
          min: Math.max(1, Math.round(m * 0.8)),
          max: Math.max(2, Math.round(m * 1.2)),
        });
        break;
      case "normal":
        onChange({
          kind: "normal",
          mean: Math.max(1, Math.round(m)),
          stddev: Math.max(1, Math.round(m * 0.1)),
        });
        break;
      case "triangular":
        onChange({
          kind: "triangular",
          min: Math.max(1, Math.round(m * 0.7)),
          mode: Math.max(1, Math.round(m)),
          max: Math.max(2, Math.round(m * 1.5)),
        });
        break;
      case "exponential":
        onChange({ kind: "exponential", rate: 1 / Math.max(1, m) });
        break;
    }
  };

  const kindId = id ?? "dist-kind";
  return (
    <div className="space-y-2">
      {label ? (
        <label htmlFor={kindId} className="text-muted-foreground text-xs font-medium">
          {label}
        </label>
      ) : null}
      <select
        id={kindId}
        value={value.kind}
        onChange={(e) => {
          handleKindChange(e.target.value as Distribution["kind"]);
        }}
        className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
      >
        <option value="constant">Constant</option>
        <option value="uniform">Uniform</option>
        <option value="normal">Normal</option>
        <option value="triangular">Triangular</option>
        <option value="exponential">Exponential</option>
      </select>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Distribution presets">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="border-input bg-background hover:bg-muted rounded-full border px-2 py-0.5 text-[11px]"
            onClick={() => {
              const m = meanGuessOf(value);
              onChange(p.build(m));
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {value.kind === "constant"
        ? numberField(
            "Value (ms)",
            "df-const-value",
            value.value,
            (n) => {
              onChange({ kind: "constant", value: Math.max(1, n) });
            },
            { min: 1 },
          )
        : null}
      {value.kind === "uniform" ? (
        <div className="grid grid-cols-2 gap-2">
          {numberField(
            "Min (ms)",
            "df-uniform-min",
            value.min,
            (n) => {
              onChange({ kind: "uniform", min: Math.max(1, n), max: value.max });
            },
            { min: 1 },
          )}
          {numberField(
            "Max (ms)",
            "df-uniform-max",
            value.max,
            (n) => {
              onChange({ kind: "uniform", min: value.min, max: Math.max(value.min + 1, n) });
            },
            { min: value.min + 1 },
          )}
        </div>
      ) : null}
      {value.kind === "normal" ? (
        <div className="grid grid-cols-2 gap-2">
          {numberField(
            "Mean (ms)",
            "df-normal-mean",
            value.mean,
            (n) => {
              onChange({ kind: "normal", mean: Math.max(1, n), stddev: value.stddev });
            },
            { min: 1 },
          )}
          {numberField(
            "Std dev (ms)",
            "df-normal-stddev",
            value.stddev,
            (n) => {
              onChange({ kind: "normal", mean: value.mean, stddev: Math.max(0.1, n) });
            },
            { min: 0.1, step: 0.1 },
          )}
        </div>
      ) : null}
      {value.kind === "triangular" ? (
        <div className="grid grid-cols-3 gap-2">
          {numberField(
            "Min",
            "df-tri-min",
            value.min,
            (n) => {
              onChange({
                kind: "triangular",
                min: Math.max(1, n),
                mode: value.mode,
                max: value.max,
              });
            },
            { min: 1 },
          )}
          {numberField(
            "Mode",
            "df-tri-mode",
            value.mode,
            (n) => {
              onChange({
                kind: "triangular",
                min: value.min,
                mode: Math.max(value.min, n),
                max: value.max,
              });
            },
            { min: value.min },
          )}
          {numberField(
            "Max",
            "df-tri-max",
            value.max,
            (n) => {
              onChange({
                kind: "triangular",
                min: value.min,
                mode: value.mode,
                max: Math.max(value.mode, n),
              });
            },
            { min: value.mode },
          )}
        </div>
      ) : null}
      {value.kind === "exponential" ? (
        <>
          {numberField(
            "Mean (ms)",
            "df-exp-mean",
            Math.round(1 / value.rate),
            (n) => {
              onChange({ kind: "exponential", rate: 1 / Math.max(1, n) });
            },
            { min: 1 },
          )}
          <p className="text-muted-foreground text-xs">
            Implied rate: <span className="font-mono tabular-nums">{value.rate.toFixed(6)}</span>{" "}
            (events/ms)
          </p>
        </>
      ) : null}

      {/* Live histogram preview — 1000 deterministic samples binned across 24 bars. */}
      <div className="space-y-1">
        <div className="text-muted-foreground flex items-center justify-between text-[10px]">
          <span>Sampled shape (1k draws)</span>
          <span className="font-mono tabular-nums">
            mean ≈ {Math.round(meanOf(value)).toLocaleString()} ms
          </span>
        </div>
        <svg
          viewBox={`0 0 ${String(HIST_W)} ${String(HIST_H)}`}
          preserveAspectRatio="none"
          className="text-sim-running h-12 w-full"
          aria-label="Distribution preview histogram"
        >
          {histogram.bars.map((b, i) => (
            <rect
              key={`bin-${String(i)}`}
              x={b.x}
              y={HIST_H - b.h}
              width={HIST_W / HIST_BINS - 0.5}
              height={b.h}
              fill="currentColor"
              fillOpacity={0.7}
            />
          ))}
        </svg>
        <div className="text-muted-foreground flex justify-between font-mono text-[10px] tabular-nums">
          <span>{Math.round(histogram.labelLo).toLocaleString()}</span>
          <span>{Math.round(histogram.labelHi).toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
