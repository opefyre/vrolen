/**
 * Step 6 — arrivals + materials.
 *
 * VROL-871 — replaces the simple "items per minute" knob with a full
 * arrival authoring block (source toggle, inter-arrival Distribution
 * via the DistributionField primitive, batch size) and the materials
 * block from the Inspector / run-settings drawer (initial inventory,
 * per-part consumption, one-shot replenishment, recurring deliveries).
 */

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DistributionField } from "@/components/ui/distribution-field";
import { DurationInput } from "@/components/ui/duration-input";
import { NumberField } from "@/components/ui/number-field";

import { FieldError } from "./field-error";
import type { WizardDraft } from "./wizard-types";

export function StepArrivals({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const batchErr = errors?.["batchSize"];
  const bottlesErr = errors?.["bottles"];
  const capsErr = errors?.["caps"];
  const bottlesPerPartErr = errors?.["bottlesPerPart"];
  const capsPerPartErr = errors?.["capsPerPart"];
  const updateMaterials = (patch: Partial<WizardDraft["materials"]>) => {
    update({ materials: { ...draft.materials, ...patch } });
  };
  const updateArrivals = (patch: Partial<WizardDraft["arrivals"]>) => {
    update({ arrivals: { ...draft.arrivals, ...patch } });
  };
  const addRecurring = () => {
    updateMaterials({
      recurring: [
        ...draft.materials.recurring,
        { material: "bottles", amount: 100, intervalMs: 60 * 60 * 1000 },
      ],
    });
  };
  const updateRecurring = (
    idx: number,
    patch: Partial<WizardDraft["materials"]["recurring"][number]>,
  ) => {
    updateMaterials({
      recurring: draft.materials.recurring.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    });
  };
  const removeRecurring = (idx: number) => {
    updateMaterials({
      recurring: draft.materials.recurring.filter((_, i) => i !== idx),
    });
  };
  return (
    <div className="space-y-4">
      {/* Source. */}
      <div className="border-border space-y-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.arrivals.enabled}
            onChange={(e) => {
              updateArrivals({ enabled: e.target.checked });
            }}
            className="accent-sim-running h-4 w-4"
          />
          Source generates items
        </label>
        {draft.arrivals.enabled ? (
          <>
            <DistributionField
              label="Inter-arrival time (ms)"
              value={draft.arrivals.interArrivalDist}
              onChange={(d) => {
                updateArrivals({ interArrivalDist: d });
              }}
            />
            <NumberField
              id="wiz-batch"
              label="Batch size"
              value={draft.arrivals.batchSize}
              onChange={(n) => {
                updateArrivals({ batchSize: n });
              }}
              min={1}
              max={1_000}
              helperText="How many items spawn per arrival event."
            />
            <FieldError message={batchErr} />
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            Source off — items have to flow in from somewhere upstream (e.g. material input).
          </p>
        )}
      </div>

      {/* Materials. */}
      <div className="border-border space-y-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.materials.enabled}
            onChange={(e) => {
              updateMaterials({ enabled: e.target.checked });
            }}
            className="accent-sim-running h-4 w-4"
          />
          Track materials (bottles, caps)
        </label>
        {draft.materials.enabled ? (
          <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <NumberField
                  id="wiz-bottles"
                  label="Initial bottles"
                  value={draft.materials.bottles}
                  onChange={(n) => {
                    updateMaterials({ bottles: n });
                  }}
                  min={0}
                />
                <FieldError message={bottlesErr} />
              </div>
              <div>
                <NumberField
                  id="wiz-caps"
                  label="Initial caps"
                  value={draft.materials.caps}
                  onChange={(n) => {
                    updateMaterials({ caps: n });
                  }}
                  min={0}
                />
                <FieldError message={capsErr} />
              </div>
              <div>
                <NumberField
                  id="wiz-bottlesPerPart"
                  label="Bottles per part"
                  value={draft.materials.bottlesPerPart}
                  onChange={(n) => {
                    updateMaterials({ bottlesPerPart: n });
                  }}
                  min={0}
                  step={0.01}
                />
                <FieldError message={bottlesPerPartErr} />
              </div>
              <div>
                <NumberField
                  id="wiz-capsPerPart"
                  label="Caps per part"
                  value={draft.materials.capsPerPart}
                  onChange={(n) => {
                    updateMaterials({ capsPerPart: n });
                  }}
                  min={0}
                  step={0.01}
                />
                <FieldError message={capsPerPartErr} />
              </div>
            </div>

            {/* One-shot replenishment. */}
            <div className="border-border rounded-md border border-dashed p-3">
              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={draft.materials.replenishment.enabled}
                  onChange={(e) => {
                    updateMaterials({
                      replenishment: {
                        ...draft.materials.replenishment,
                        enabled: e.target.checked,
                      },
                    });
                  }}
                  className="accent-sim-running h-4 w-4"
                />
                One-shot replenishment
              </label>
              {draft.materials.replenishment.enabled ? (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <DurationInput
                    id="wiz-replen-atMs"
                    label="At"
                    valueMs={draft.materials.replenishment.atMs}
                    onChangeMs={(ms) => {
                      updateMaterials({
                        replenishment: { ...draft.materials.replenishment, atMs: ms },
                      });
                    }}
                    defaultUnit="min"
                    min={0}
                  />
                  <NumberField
                    id="wiz-replen-amount"
                    label="Amount"
                    value={draft.materials.replenishment.amount}
                    onChange={(n) => {
                      updateMaterials({
                        replenishment: { ...draft.materials.replenishment, amount: n },
                      });
                    }}
                    min={0}
                  />
                </div>
              ) : null}
            </div>

            {/* Recurring deliveries. */}
            <div className="border-border space-y-2 rounded-md border border-dashed p-3">
              <div className="text-xs font-medium">Recurring deliveries</div>
              {draft.materials.recurring.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No recurring deliveries. Add one to model a finite-rate supplier.
                </p>
              ) : (
                draft.materials.recurring.map((r, idx) => (
                  <div
                    key={`recurring-${String(idx)}`}
                    className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                  >
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor={`wiz-recurring-${String(idx)}-mat`}
                        className="text-muted-foreground text-[10px] font-medium"
                      >
                        Material
                      </label>
                      <select
                        id={`wiz-recurring-${String(idx)}-mat`}
                        value={r.material}
                        onChange={(e) => {
                          const material = e.target.value === "caps" ? "caps" : "bottles";
                          updateRecurring(idx, { material });
                        }}
                        className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                      >
                        <option value="bottles">Bottles</option>
                        <option value="caps">Caps</option>
                      </select>
                    </div>
                    <NumberField
                      id={`wiz-recurring-${String(idx)}-amount`}
                      label="Amount"
                      value={r.amount}
                      onChange={(n) => {
                        updateRecurring(idx, { amount: n });
                      }}
                      min={0}
                    />
                    <DurationInput
                      id={`wiz-recurring-${String(idx)}-interval`}
                      label="Every"
                      valueMs={r.intervalMs}
                      onChangeMs={(ms) => {
                        updateRecurring(idx, { intervalMs: ms });
                      }}
                      defaultUnit="min"
                      min={1}
                    />
                    <NumberField
                      id={`wiz-recurring-${String(idx)}-max`}
                      label="Max inventory"
                      value={r.maxInventory ?? 0}
                      onChange={(n) => {
                        updateRecurring(idx, { maxInventory: n > 0 ? n : undefined });
                      }}
                      min={0}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        removeRecurring(idx);
                      }}
                      aria-label={`Remove recurring delivery ${String(idx + 1)}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))
              )}
              <Button size="sm" variant="outline" onClick={addRecurring} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add recurring delivery
              </Button>
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            When off, the engine ignores material constraints — stations process every part they
            see.
          </p>
        )}
      </div>
    </div>
  );
}
