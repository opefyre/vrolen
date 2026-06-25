/**
 * VROL-954 / VROL-998 — Goal-seek UI. User enters a target throughput;
 * the card surfaces (a) the single-lever cycle scale that hits it and
 * (b) the multi-lever (cycle + buffer + tool-pool) cheapest combo that
 * hits it. Each lever has its own Apply chip so the user can pick what
 * they want to act on.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { GoalResult } from "@/lib/goal-mode";
import type { MultiResult } from "@/lib/goal-mode-multi";
import type { ActionApplyPayload } from "@/lib/derive-action-card";

interface Props {
  readonly baselinePerHour: number;
  readonly running: boolean;
  /** onRun receives the target in PARTS/h (engine units), not display units. */
  readonly onRun: (targetPerHour: number) => void;
  /** Single-lever apply (uniform cycle multiplier). */
  readonly onApply: (multiplier: number) => void;
  readonly result: GoalResult | null;
  /** VROL-998 — multi-lever result (optional). */
  readonly multiResult?: MultiResult | null;
  /** VROL-998 — multi-lever per-lever apply. EditorPage routes the payload. */
  readonly onApplyMulti?: (payload: ActionApplyPayload) => void;
  /**
   * VROL-1020 — sink unit + ratio. Displayed values multiply by
   * unitsPerPart; the target input is treated as display units and
   * converted back to parts/h before calling onRun. Defaults to
   * "parts" / 1 (legacy behaviour).
   */
  readonly throughputUnit?: string;
  readonly unitsPerPart?: number;
}

export function GoalModeCard({
  baselinePerHour,
  running,
  onRun,
  onApply,
  result,
  multiResult,
  onApplyMulti,
  throughputUnit = "parts",
  unitsPerPart = 1,
}: Props) {
  const unitLabel = throughputUnit && throughputUnit.length > 0 ? throughputUnit : "parts";
  // VROL-1020 — initial target is 120 % of baseline IN DISPLAY UNITS.
  // The engine still runs in parts/h, but the user types/sees the
  // declared unit.
  const baselineDisplay = baselinePerHour * unitsPerPart;
  const [target, setTarget] = useState<number>(Math.round(baselineDisplay * 1.2));
  const fmt = (partsPerHour: number): string =>
    Math.round(partsPerHour * unitsPerPart).toLocaleString();
  const multiBest = multiResult?.best ?? null;
  // Show the multi-lever block when it found a candidate that beats
  // single-lever on cost OR uses non-cycle levers (buffer / pool).
  const multiBeatsSingle =
    !!multiBest &&
    multiBest.meetsTarget &&
    (multiBest.bufferDelta > 0 ||
      multiBest.toolPoolDelta > 0 ||
      (result && multiBest.cost < 10 * Math.abs(1 - result.multiplier)));
  return (
    <div
      className="border-border bg-card/50 space-y-2 rounded-md border p-3"
      data-testid="goal-mode-card"
    >
      <div className="text-foreground text-sm font-medium">Goal mode</div>
      <p className="text-muted-foreground text-xs">
        Set a target throughput; the engine sweeps cycle-time scales (0.5x–1.0x of baseline) and
        returns the gentlest change that hits the target.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={target}
          min={0}
          onChange={(e) => {
            setTarget(Math.max(0, Math.floor(Number(e.target.value) || 0)));
          }}
          className="border-input bg-background w-32 rounded-md border px-2 py-1.5 font-mono text-sm tabular-nums"
          aria-label={`Target ${unitLabel} per hour`}
        />
        <span className="text-muted-foreground text-xs">{unitLabel} / h</span>
        <Button
          variant="outline"
          size="sm"
          disabled={running || target <= 0}
          onClick={() => {
            // VROL-1020 — engine works in parts/h. Convert display
            // units back via /unitsPerPart before invoking onRun.
            onRun(target / unitsPerPart);
          }}
        >
          {running ? "Searching…" : "Find cheapest"}
        </Button>
      </div>
      {result ? (
        <div className="border-border space-y-1 rounded-md border p-2 text-xs">
          {result.capped ? (
            <p className="text-sim-down-foreground">
              Even at maximum speed-up (0.5x cycle time), the line tops out at{" "}
              <strong className="font-mono tabular-nums">{fmt(result.achievedPerHour)}</strong>{" "}
              {unitLabel}/h — short of the target.
            </p>
          ) : (
            <p>
              <strong>Single lever:</strong> cycle scale{" "}
              <strong className="font-mono tabular-nums">{result.multiplier.toFixed(2)}x</strong>{" "}
              hits <strong className="font-mono tabular-nums">{fmt(result.achievedPerHour)}</strong>{" "}
              {unitLabel}/h (baseline{" "}
              <span className="text-muted-foreground font-mono tabular-nums">
                {fmt(result.baselinePerHour)}
              </span>
              ).
            </p>
          )}
          {!result.capped && Math.abs(1 - result.multiplier) > 1e-3 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                onApply(result.multiplier);
              }}
            >
              Apply uniform cycle {result.multiplier.toFixed(2)}x
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* VROL-998 — multi-lever picker. Renders when the search found a
          candidate that genuinely uses non-cycle levers or beats the
          single-lever cost. */}
      {multiBeatsSingle && multiBest ? (
        <div
          className="border-sim-running/40 bg-sim-running/5 space-y-2 rounded-md border p-2 text-xs"
          data-testid="goal-mode-multi"
        >
          <p>
            <strong>Multi-lever:</strong> cycle{" "}
            <span className="font-mono tabular-nums">{multiBest.cycleMultiplier.toFixed(2)}x</span>
            {multiBest.bufferDelta > 0 ? (
              <>
                {" "}
                + buffer{" "}
                <span className="font-mono tabular-nums">+{String(multiBest.bufferDelta)}</span>
              </>
            ) : null}
            {multiBest.toolPoolDelta > 0 ? (
              <>
                {" "}
                + tool pools{" "}
                <span className="font-mono tabular-nums">+{String(multiBest.toolPoolDelta)}</span>
              </>
            ) : null}{" "}
            hits <strong className="font-mono tabular-nums">{fmt(multiBest.perHour)}</strong>{" "}
            {unitLabel}/h. Cost{" "}
            <span className="font-mono tabular-nums">{multiBest.cost.toFixed(1)}</span>.
          </p>
          {onApplyMulti ? (
            <div className="flex flex-wrap gap-1.5">
              {Math.abs(1 - multiBest.cycleMultiplier) > 1e-3 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onApplyMulti({
                      kind: "cycle:scaleAll",
                      multiplier: multiBest.cycleMultiplier,
                    });
                  }}
                >
                  Apply cycle {multiBest.cycleMultiplier.toFixed(2)}x
                </Button>
              ) : null}
              {multiBest.bufferDelta > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    // Apply via the existing buffer:grow handler — our handler
                    // ignores edgeKey for additive grow.
                    onApplyMulti({ kind: "buffer:grow", edgeKey: "all" });
                  }}
                >
                  Apply buffer +{String(multiBest.bufferDelta)}
                </Button>
              ) : null}
              {multiBest.toolPoolDelta > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onApplyMulti({
                      kind: "tool-pool:scaleAll",
                      delta: multiBest.toolPoolDelta,
                    });
                  }}
                >
                  Apply tool +{String(multiBest.toolPoolDelta)}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
