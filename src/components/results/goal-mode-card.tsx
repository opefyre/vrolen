/**
 * VROL-954 — Goal-seek UI. User enters a target throughput; we display
 * the smallest cycle-time multiplier that meets it (from
 * findCycleMultiplierForTarget). Apply button feeds the scenario.
 */

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { GoalResult } from "@/lib/goal-mode";

interface Props {
  readonly baselinePerHour: number;
  readonly running: boolean;
  readonly onRun: (targetPerHour: number) => void;
  readonly onApply: (multiplier: number) => void;
  readonly result: GoalResult | null;
}

export function GoalModeCard({ baselinePerHour, running, onRun, onApply, result }: Props) {
  const [target, setTarget] = useState<number>(Math.round(baselinePerHour * 1.2));
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
          aria-label="Target parts per hour"
        />
        <span className="text-muted-foreground text-xs">parts / h</span>
        <Button
          variant="outline"
          size="sm"
          disabled={running || target <= 0}
          onClick={() => {
            onRun(target);
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
              <strong className="font-mono tabular-nums">
                {Math.round(result.achievedPerHour).toLocaleString()}
              </strong>{" "}
              parts/h — short of the target.
            </p>
          ) : (
            <p>
              Cycle-time scale{" "}
              <strong className="font-mono tabular-nums">{result.multiplier.toFixed(2)}x</strong>{" "}
              hits{" "}
              <strong className="font-mono tabular-nums">
                {Math.round(result.achievedPerHour).toLocaleString()}
              </strong>{" "}
              parts/h (baseline{" "}
              <span className="text-muted-foreground font-mono tabular-nums">
                {Math.round(result.baselinePerHour).toLocaleString()}
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
              Apply to every station
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
