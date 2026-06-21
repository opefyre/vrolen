/**
 * VROL-844 — replications planner widget.
 *
 * Given the current KPI's mean + stddev (from the most recent multi-rep
 * run), compute how many replications would be needed to hit a target
 * relative half-width at the chosen confidence level. The actual
 * arithmetic lives in `./reps-calc` so this file is component-only
 * (keeps Vite Fast Refresh happy).
 */

import { CheckCircle2, Hourglass } from "lucide-react";
import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberField } from "@/components/ui/number-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { type ConfidenceLevel, requiredReplications } from "./reps-calc";

interface RepsCalculatorProps {
  /** KPI label shown in the copy, e.g. "throughput". */
  readonly kpiLabel: string;
  /** Sample mean from the current multi-rep run. */
  readonly mean: number;
  /** Sample standard deviation from the current multi-rep run. */
  readonly stddev: number;
  /** How many replications the current run actually used. */
  readonly currentReps: number;
}

export function RepsCalculator({ kpiLabel, mean, stddev, currentReps }: RepsCalculatorProps) {
  const [targetPct, setTargetPct] = useState<number>(5);
  const [confidence, setConfidence] = useState<ConfidenceLevel>(95);
  const targetRel = targetPct / 100;
  const required = requiredReplications(mean, stddev, targetRel, confidence);

  return (
    <Card id="replications-planner">
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2 text-base">
          <Hourglass className="h-4 w-4" aria-hidden /> Replications planner
        </CardTitle>
        <CardDescription>
          Estimate how many replications you&rsquo;d need to hit a target precision on {kpiLabel}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <NumberField
            id="reps-calc-target"
            label="Target relative precision (%)"
            value={targetPct}
            onChange={setTargetPct}
            min={0.1}
            max={50}
            step={0.5}
            helperText="Half-width as a percent of the mean."
          />
          <div className="flex flex-col gap-1">
            <label
              htmlFor="reps-calc-confidence"
              className="text-muted-foreground text-xs font-medium select-none"
            >
              Confidence level
            </label>
            <Select
              value={String(confidence)}
              onValueChange={(v) => {
                if (typeof v === "string") {
                  const parsed = Number(v);
                  if (parsed === 90 || parsed === 95 || parsed === 99) setConfidence(parsed);
                }
              }}
            >
              <SelectTrigger id="reps-calc-confidence" aria-label="Confidence level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="90">90%</SelectItem>
                <SelectItem value="95">95%</SelectItem>
                <SelectItem value="99">99%</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {required === null ? (
          <p className="text-muted-foreground text-sm">
            Not enough signal to plan — the current run&rsquo;s {kpiLabel} mean is zero or invalid.
          </p>
        ) : (
          <>
            <p className="text-sm">
              You&rsquo;d need{" "}
              <strong className="text-foreground font-mono tabular-nums">~{required}</strong>{" "}
              replications to hit ±
              <span className="font-mono tabular-nums">
                {targetPct.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 1,
                })}
                %
              </span>{" "}
              on {kpiLabel} with {confidence}% confidence.
            </p>
            <RepsBadge currentReps={currentReps} requiredReps={required} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Sentence-cased status pill. Uses --sim-running for the "ok" state and
 * --sim-down for the "more reps needed" state to match the rest of the
 * result panel's tone language.
 */
function RepsBadge({
  currentReps,
  requiredReps,
}: {
  readonly currentReps: number;
  readonly requiredReps: number;
}) {
  const ok = currentReps >= requiredReps;
  const Icon = ok ? CheckCircle2 : Hourglass;
  const toneClass = ok
    ? "bg-sim-running/15 text-sim-running border-sim-running/30"
    : "bg-sim-down/15 text-sim-down-foreground border-sim-down/30";
  const label = ok ? "Already precise enough" : "More reps needed";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground font-mono tabular-nums">
        Current run: {currentReps} reps
      </span>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${toneClass}`}
        aria-label={label}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </span>
    </div>
  );
}

export default RepsCalculator;
