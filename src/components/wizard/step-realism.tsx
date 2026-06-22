/**
 * Step 5 — realism block.
 *
 * VROL-871 — replaces the old three-card realism picker with the fields
 * that actually shape engine behavior:
 *   - Breakdowns (MTBF / MTTR) — note the engine applies these line-wide.
 *   - Per-station maintenance windows (via MaintenanceWindowsEditor).
 *   - Per-station rework target + reworkPassLimit, with a warning when
 *     the target points outside the connected DAG.
 *   - Workers (optional). Authored as a list of {name, shiftEndMs,
 *     skills[]}; per-station required skill lives next to the
 *     maintenance editor so all the per-station realism knobs sit next
 *     to each other.
 */

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DurationInput } from "@/components/ui/duration-input";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { MaintenanceWindowsEditor } from "@/editor/inspector-fields";

import { FieldError } from "./field-error";
import type { RealismLevel, WizardDraft, WizardStation, WizardWorker } from "./wizard-types";

export function StepRealism({
  draft,
  update,
  setRealism,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly setRealism: (level: RealismLevel) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const mtbfError = errors?.["mtbf"];
  const mttrError = errors?.["mttr"];
  const workersError = errors?.["workers"];
  const updateStation = (idx: number, patch: Partial<WizardStation>) => {
    update({
      stations: draft.stations.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  };
  const updateWorker = (idx: number, patch: Partial<WizardWorker>) => {
    update({
      workers: draft.workers.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    });
  };
  const addWorker = () => {
    update({
      workers: [
        ...draft.workers,
        {
          name: `Worker ${String(draft.workers.length + 1)}`,
          shiftEndMs: draft.runWindow.horizonMs,
          skills: ["any"],
        },
      ],
    });
  };
  const removeWorker = (idx: number) => {
    if (draft.workers.length <= 1) return;
    update({ workers: draft.workers.filter((_, i) => i !== idx) });
  };
  return (
    <div className="space-y-4">
      {/* Realism preset — keeps the simple/realistic/stress shortcut for quick fills. */}
      <div className="space-y-1">
        <div className="text-foreground/90 text-sm font-medium">Quick preset</div>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Realism preset">
          {(["simple", "realistic", "stress"] as const).map((level) => {
            const isSelected = draft.realism === level;
            return (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setRealism(level);
                }}
                className={`rounded-md border px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  isSelected
                    ? "border-sim-running bg-sim-running/15 text-sim-running"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>
        <p className="text-muted-foreground text-xs">
          Sets sensible defaults below — you can still tweak everything by hand.
        </p>
      </div>

      {/* Breakdowns. */}
      <div className="border-border space-y-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.breakdowns.enabled}
            onChange={(e) => {
              update({ breakdowns: { ...draft.breakdowns, enabled: e.target.checked } });
            }}
            className="accent-sim-running h-4 w-4"
          />
          Stochastic breakdowns
        </label>
        <p className="text-muted-foreground text-xs">
          The current engine applies MTBF / MTTR line-wide, not per station.
        </p>
        {draft.breakdowns.enabled ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <DurationInput
                id="wiz-mtbf"
                label="Mean time between failures"
                valueMs={draft.breakdowns.mtbfMs}
                onChangeMs={(ms) => {
                  update({ breakdowns: { ...draft.breakdowns, mtbfMs: ms } });
                }}
                defaultUnit="min"
                min={1}
                helperText="Average run-time before the line breaks down."
              />
              <FieldError message={mtbfError} />
            </div>
            <div>
              <DurationInput
                id="wiz-mttr"
                label="Mean time to repair"
                valueMs={draft.breakdowns.mttrMs}
                onChangeMs={(ms) => {
                  update({ breakdowns: { ...draft.breakdowns, mttrMs: ms } });
                }}
                defaultUnit="min"
                min={1}
                helperText="Average repair duration."
              />
              <FieldError message={mttrError} />
            </div>
          </div>
        ) : null}
      </div>

      {/* Per-station maintenance + rework + skill. */}
      <div className="space-y-2">
        <div className="text-foreground/90 text-sm font-medium">
          Per-station maintenance + rework
        </div>
        <p className="text-muted-foreground text-xs">
          Set maintenance windows, defect rework target, and required worker skill on each station.
        </p>
        {draft.stations.map((s, idx) => {
          const reworkErr = errors?.[`station-${String(idx)}-rework`];
          return (
            <details key={s.id} className="border-border bg-background/40 rounded-md border">
              <summary className="cursor-pointer p-2 text-sm font-medium">{s.label}</summary>
              <div className="space-y-3 border-t p-3">
                <MaintenanceWindowsEditor
                  value={s.maintenanceWindows.map((w) => ({ ...w }))}
                  onChange={(next) => {
                    updateStation(idx, { maintenanceWindows: next });
                  }}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`station-${String(idx)}-rework`}
                      className="text-muted-foreground text-xs font-medium"
                    >
                      Rework target
                    </label>
                    <select
                      id={`station-${String(idx)}-rework`}
                      value={s.reworkTargetId ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateStation(idx, { reworkTargetId: v === "" ? null : v });
                      }}
                      className="border-input bg-background mt-1 h-9 w-full rounded-md border px-3 text-sm"
                    >
                      <option value="">Scrap defects (default)</option>
                      {draft.stations
                        .filter((other) => other.id !== s.id)
                        .map((other) => (
                          <option key={other.id} value={other.id}>
                            {other.label}
                          </option>
                        ))}
                    </select>
                    {reworkErr ? <FieldError message={reworkErr} /> : null}
                  </div>
                  <NumberField
                    id={`station-${String(idx)}-rework-limit`}
                    label="Rework pass limit"
                    value={s.reworkPassLimit}
                    onChange={(n) => {
                      updateStation(idx, { reworkPassLimit: n });
                    }}
                    min={1}
                    max={20}
                    helperText="After this many passes, defects scrap."
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor={`station-${String(idx)}-skill`}
                      className="text-muted-foreground text-xs font-medium"
                    >
                      Required skill (optional)
                    </label>
                    <Input
                      id={`station-${String(idx)}-skill`}
                      value={s.requiredSkill}
                      onChange={(e) => {
                        updateStation(idx, { requiredSkill: e.target.value });
                      }}
                      placeholder="e.g. welding"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      {/* Workers. */}
      <div className="border-border space-y-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.workersEnabled}
            onChange={(e) => {
              update({ workersEnabled: e.target.checked });
            }}
            className="accent-sim-running h-4 w-4"
          />
          Use a worker pool
        </label>
        {draft.workersEnabled ? (
          <>
            <p className="text-muted-foreground text-xs">
              Workers are matched to stations by skill. Each worker has a shift end and a comma-
              separated skill list.
            </p>
            <div className="space-y-2">
              {draft.workers.map((w, idx) => {
                const nameErr = errors?.[`worker-${String(idx)}-name`];
                const shiftErr = errors?.[`worker-${String(idx)}-shift`];
                return (
                  <div
                    key={`worker-${String(idx)}`}
                    className="border-border bg-background/30 grid grid-cols-1 gap-2 rounded-md border p-2 sm:grid-cols-[1fr_auto_1fr_auto]"
                  >
                    <div>
                      <label
                        htmlFor={`worker-${String(idx)}-name`}
                        className="text-muted-foreground text-[10px] font-medium"
                      >
                        Name
                      </label>
                      <Input
                        id={`worker-${String(idx)}-name`}
                        value={w.name}
                        onChange={(e) => {
                          updateWorker(idx, { name: e.target.value });
                        }}
                        className="h-8 text-sm"
                        aria-invalid={nameErr ? true : undefined}
                      />
                      <FieldError message={nameErr} />
                    </div>
                    <DurationInput
                      id={`worker-${String(idx)}-shift`}
                      label="Shift end"
                      valueMs={w.shiftEndMs}
                      onChangeMs={(ms) => {
                        updateWorker(idx, { shiftEndMs: ms });
                      }}
                      defaultUnit="h"
                      min={1000}
                    />
                    <div>
                      <label
                        htmlFor={`worker-${String(idx)}-skills`}
                        className="text-muted-foreground text-[10px] font-medium"
                      >
                        Skills (comma-separated)
                      </label>
                      <Input
                        id={`worker-${String(idx)}-skills`}
                        value={w.skills.join(", ")}
                        onChange={(e) => {
                          const skills = e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0);
                          updateWorker(idx, { skills });
                        }}
                        placeholder="any"
                        className="h-8 text-sm"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        removeWorker(idx);
                      }}
                      disabled={draft.workers.length <= 1}
                      aria-label={`Remove ${w.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    {shiftErr ? <FieldError message={shiftErr} /> : null}
                  </div>
                );
              })}
            </div>
            <FieldError message={workersError} />
            <Button size="sm" variant="outline" onClick={addWorker} className="gap-1">
              <Plus className="h-3.5 w-3.5" />
              Add worker
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            When off, stations process work without needing a matched worker.
          </p>
        )}
      </div>
    </div>
  );
}
