/**
 * Step 4 — products + recipe (gated by a checkbox).
 *
 * VROL-871 — when multi-product mode is on, the user authors the
 * product list, per-station per-product cycle overrides (via the
 * existing PerProductCyclesEditor primitive), and a per-station
 * changeover matrix. The changeover matrix has no Inspector UI today,
 * so this step is also where it lives.
 */

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DistributionField } from "@/components/ui/distribution-field";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { constant, type Distribution } from "@/engine";
import { PerProductCyclesEditor } from "@/editor/inspector-fields";

import { FieldError } from "./field-error";
import type {
  ChangeoverMatrices,
  PerProductCycles,
  WizardDraft,
  WizardProduct,
} from "./wizard-types";

export function StepProducts({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const countError = errors?.["count"];
  const setEnabled = (enabled: boolean) => {
    update({ productsEnabled: enabled });
  };
  const updateProduct = (idx: number, patch: Partial<WizardProduct>) => {
    update({
      products: draft.products.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });
  };
  const addProduct = () => {
    const nextId = `P${String(draft.products.length + 1)}`;
    update({
      products: [...draft.products, { id: nextId, name: `Product ${nextId}`, weight: 1 }],
    });
  };
  const removeProduct = (idx: number) => {
    if (draft.products.length <= 1) return;
    update({ products: draft.products.filter((_, i) => i !== idx) });
  };
  const setPerProductCycles = (stationId: string, value: Record<string, Distribution>) => {
    const next: PerProductCycles = { ...draft.perProductCycles, [stationId]: value };
    // Drop empty maps so saved drafts stay tidy.
    if (Object.keys(value).length === 0) {
      const cloned: Record<string, Readonly<Record<string, Distribution>>> = { ...next };
      delete cloned[stationId];
      update({ perProductCycles: cloned });
    } else {
      update({ perProductCycles: next });
    }
  };
  const setChangeoverMatrix = (
    stationId: string,
    value: Readonly<Record<string, Readonly<Record<string, Distribution>>>>,
  ) => {
    const next: ChangeoverMatrices = { ...draft.changeoverMatrices, [stationId]: value };
    if (Object.keys(value).length === 0) {
      const cloned: Record<
        string,
        Readonly<Record<string, Readonly<Record<string, Distribution>>>>
      > = {
        ...next,
      };
      delete cloned[stationId];
      update({ changeoverMatrices: cloned });
    } else {
      update({ changeoverMatrices: next });
    }
  };
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={draft.productsEnabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
          }}
          className="accent-sim-running h-4 w-4"
        />
        Run with multiple products
      </label>
      {!draft.productsEnabled ? (
        <p className="text-muted-foreground text-xs">
          When off, the line produces a single anonymous part type. Turn this on to model multiple
          SKUs flowing through the same stations.
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {draft.products.map((p, idx) => {
              const idError = errors?.[`product-${String(idx)}-id`];
              const nameError = errors?.[`product-${String(idx)}-name`];
              const weightError = errors?.[`product-${String(idx)}-weight`];
              return (
                <div
                  key={p.id}
                  className="border-border bg-background/40 grid grid-cols-[1fr_1fr_auto_auto] items-end gap-2 rounded-md border p-2"
                >
                  <div className="space-y-1">
                    <label
                      htmlFor={`product-${String(idx)}-id`}
                      className="text-muted-foreground text-[10px] font-medium"
                    >
                      Id
                    </label>
                    <Input
                      id={`product-${String(idx)}-id`}
                      value={p.id}
                      onChange={(e) => {
                        updateProduct(idx, { id: e.target.value });
                      }}
                      className="h-8 text-sm"
                      aria-invalid={idError ? true : undefined}
                    />
                    <FieldError message={idError} />
                  </div>
                  <div className="space-y-1">
                    <label
                      htmlFor={`product-${String(idx)}-name`}
                      className="text-muted-foreground text-[10px] font-medium"
                    >
                      Name
                    </label>
                    <Input
                      id={`product-${String(idx)}-name`}
                      value={p.name}
                      onChange={(e) => {
                        updateProduct(idx, { name: e.target.value });
                      }}
                      className="h-8 text-sm"
                      aria-invalid={nameError ? true : undefined}
                    />
                    <FieldError message={nameError} />
                  </div>
                  <NumberField
                    id={`product-${String(idx)}-weight`}
                    label="Weight"
                    value={p.weight}
                    onChange={(n) => {
                      updateProduct(idx, { weight: n });
                    }}
                    min={0.0001}
                    step={1}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      removeProduct(idx);
                    }}
                    disabled={draft.products.length <= 1}
                    aria-label={`Remove product ${p.id}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {weightError ? <FieldError message={weightError} /> : null}
                </div>
              );
            })}
          </div>
          <FieldError message={countError} />
          <Button size="sm" variant="outline" onClick={addProduct} className="gap-1">
            <Plus className="h-3.5 w-3.5" />
            Add product
          </Button>
          <div className="space-y-3 pt-2">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              Per-station recipe
            </div>
            {draft.stations.map((s) => (
              <details key={s.id} className="border-border bg-background/30 rounded-md border">
                <summary className="cursor-pointer p-2 text-sm font-medium">{s.label}</summary>
                <div className="space-y-3 border-t p-3">
                  <PerProductCyclesEditor
                    products={draft.products.map((p) => ({ ...p }))}
                    value={Object.fromEntries(Object.entries(draft.perProductCycles[s.id] ?? {}))}
                    onChange={(next) => {
                      setPerProductCycles(s.id, next);
                    }}
                  />
                  <ChangeoverMatrixEditor
                    products={draft.products}
                    stationLabel={s.label}
                    value={draft.changeoverMatrices[s.id] ?? {}}
                    onChange={(next) => {
                      setChangeoverMatrix(s.id, next);
                    }}
                  />
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Sentence-case changeover matrix. Each cell answers: "When switching
 * from A to B at this station, the changeover takes …". Diagonal cells
 * (A → A) are skipped — same product means no changeover.
 *
 * Cells default to "Not authored" (constant(0)); clicking the cell
 * opens a DistributionField below the matrix so the user can edit it
 * without inflating the grid.
 */
function ChangeoverMatrixEditor({
  products,
  stationLabel,
  value,
  onChange,
}: {
  readonly products: readonly WizardProduct[];
  readonly stationLabel: string;
  readonly value: Readonly<Record<string, Readonly<Record<string, Distribution>>>>;
  readonly onChange: (
    next: Readonly<Record<string, Readonly<Record<string, Distribution>>>>,
  ) => void;
}) {
  // Render even when products.length === 1 so the user sees the editor
  // is here — just renders an explanatory empty state.
  const fromIds = products.map((p) => p.id);
  const toIds = products.map((p) => p.id);
  return (
    <div className="border-border rounded-md border border-dashed p-3">
      <div className="text-xs font-medium">Changeover matrix</div>
      <p className="text-muted-foreground text-xs">
        When switching from one product to another at {stationLabel}, how long does the changeover
        take?
      </p>
      {products.length < 2 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          Add a second product above to author changeover times.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {fromIds.map((from) =>
            toIds
              .filter((to) => to !== from)
              .map((to) => {
                const cell = value[from]?.[to];
                const enabled = cell !== undefined;
                return (
                  <div
                    key={`${from}->${to}`}
                    className="border-border bg-background/40 rounded-md border p-2"
                  >
                    <label className="flex items-center gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => {
                          if (e.target.checked) {
                            const fromMap = { ...(value[from] ?? {}) };
                            fromMap[to] = constant(60_000);
                            onChange({ ...value, [from]: fromMap });
                          } else {
                            const fromMap = { ...(value[from] ?? {}) };
                            delete fromMap[to];
                            const next = { ...value, [from]: fromMap };
                            if (Object.keys(fromMap).length === 0) delete next[from];
                            onChange(next);
                          }
                        }}
                        className="accent-sim-running h-4 w-4"
                      />
                      <span>
                        From <span className="font-mono">{from}</span> to{" "}
                        <span className="font-mono">{to}</span>
                      </span>
                    </label>
                    {enabled && cell ? (
                      <div className="pt-2">
                        <DistributionField
                          value={cell}
                          onChange={(d) => {
                            const fromMap = { ...(value[from] ?? {}) };
                            fromMap[to] = d;
                            onChange({ ...value, [from]: fromMap });
                          }}
                        />
                      </div>
                    ) : (
                      <p className="text-muted-foreground pl-6 text-[11px]">
                        Defaults to instant (0 ms) when unchecked.
                      </p>
                    )}
                  </div>
                );
              }),
          )}
        </div>
      )}
    </div>
  );
}
