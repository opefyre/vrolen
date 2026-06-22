/**
 * Step 7 — run window.
 *
 * VROL-871 — surfaces the bits of RunSettings the wizard previously
 * hard-coded: horizon, warm-up, seed, inter-station buffer capacity,
 * replications, and the sampler interval. The user can also toggle the
 * sampler off entirely (samplerIntervalMs = 0).
 */

import { DurationInput } from "@/components/ui/duration-input";
import { NumberField } from "@/components/ui/number-field";

import { FieldError } from "./field-error";
import type { WizardDraft } from "./wizard-types";

export function StepRunWindow({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const horizonErr = errors?.["horizonMs"];
  const warmupErr = errors?.["warmupMs"];
  const seedErr = errors?.["seed"];
  const bufferErr = errors?.["bufferCap"];
  const repsErr = errors?.["replications"];
  const samplerErr = errors?.["samplerIntervalMs"];
  const updateRun = (patch: Partial<WizardDraft["runWindow"]>) => {
    update({ runWindow: { ...draft.runWindow, ...patch } });
  };
  const samplerOn = draft.runWindow.samplerIntervalMs > 0;
  return (
    <div className="space-y-4">
      <p className="text-foreground/80 text-sm">
        How long should the simulation run, and with what level of statistical confidence?
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <DurationInput
            id="wiz-horizon"
            label="Run length (horizon)"
            valueMs={draft.runWindow.horizonMs}
            onChangeMs={(ms) => {
              updateRun({ horizonMs: ms });
            }}
            defaultUnit="h"
            min={1000}
            helperText="Total simulated time."
          />
          <FieldError message={horizonErr} />
        </div>
        <div>
          <DurationInput
            id="wiz-warmup"
            label="Warm-up window"
            valueMs={draft.runWindow.warmupMs}
            onChangeMs={(ms) => {
              updateRun({ warmupMs: ms });
            }}
            defaultUnit="min"
            min={0}
            helperText="Discarded from KPI math so startup transients don't bias the numbers."
          />
          <FieldError message={warmupErr} />
        </div>
        <div>
          <NumberField
            id="wiz-seed"
            label="Random seed"
            value={draft.runWindow.seed}
            onChange={(n) => {
              updateRun({ seed: n });
            }}
            helperText="Same seed = same run. Vary it to explore noise."
          />
          <FieldError message={seedErr} />
        </div>
        <div>
          <NumberField
            id="wiz-buffer"
            label="Inter-station buffer capacity"
            value={draft.runWindow.interStationBufferCapacity}
            onChange={(n) => {
              updateRun({ interStationBufferCapacity: n });
            }}
            min={1}
            max={1000}
            helperText="WIP each edge can hold before the upstream station blocks."
          />
          <FieldError message={bufferErr} />
        </div>
        <div>
          <NumberField
            id="wiz-reps"
            label="Replications"
            value={draft.runWindow.replications}
            onChange={(n) => {
              updateRun({ replications: n });
            }}
            min={1}
            max={50}
            helperText="More replications = tighter CI on every KPI."
          />
          <FieldError message={repsErr} />
        </div>
      </div>
      <div className="border-border space-y-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={samplerOn}
            onChange={(e) => {
              updateRun({ samplerIntervalMs: e.target.checked ? 60_000 : 0 });
            }}
            className="accent-sim-running h-4 w-4"
          />
          Sample throughput timeseries
        </label>
        {samplerOn ? (
          <>
            <DurationInput
              id="wiz-sampler"
              label="Sampler interval"
              valueMs={draft.runWindow.samplerIntervalMs}
              onChangeMs={(ms) => {
                updateRun({ samplerIntervalMs: ms });
              }}
              defaultUnit="min"
              min={100}
              helperText="Smaller = smoother chart, slightly slower run."
            />
            <FieldError message={samplerErr} />
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            When off, the throughput chart and per-station sparklines have no data.
          </p>
        )}
      </div>
    </div>
  );
}
