/**
 * VROL-879 — per-station changeover matrix editor.
 *
 * The matrix is `Record<fromProductId, Record<toProductId, Distribution>>`.
 * Each cell is the setup/changeover time when the station transitions from
 * one product to another (e.g., A → A is typically a no-op; A → B costs
 * a few minutes for tool swap or cleaning).
 *
 * Empty / missing cells fall back to the station's default setupTimeMs.
 * Same-product diagonal entries default to "no entry" (no changeover) so
 * the matrix stays sparse and readable.
 */

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DistributionField } from "@/components/ui/distribution-field";
import { constant, type Distribution } from "@/engine";

type Matrix = Record<string, Record<string, Distribution>>;

interface Props {
  readonly products: readonly { id: string; name: string; weight: number }[];
  readonly value: Matrix;
  readonly onChange: (next: Matrix) => void;
}

export function ChangeoverMatrixEditor({ products, value, onChange }: Props) {
  if (products.length < 2) {
    return (
      <div className="border-border bg-card/40 rounded-md border border-dashed p-3 text-xs">
        <div className="text-foreground mb-1 font-medium">Changeover matrix</div>
        <p className="text-muted-foreground">
          Add 2+ products to define changeover times between them.
        </p>
      </div>
    );
  }
  const setCell = (from: string, to: string, dist: Distribution | null): void => {
    const next: Matrix = { ...value };
    const row = { ...(next[from] ?? {}) };
    if (dist) {
      row[to] = dist;
    } else {
      delete row[to];
    }
    if (Object.keys(row).length === 0) {
      delete next[from];
    } else {
      next[from] = row;
    }
    onChange(next);
  };
  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-3">
      <div className="text-foreground text-xs font-medium">Changeover matrix</div>
      <p className="text-muted-foreground text-xs">
        Setup time when the station transitions between products. Empty cells fall back to the
        default setup distribution.
      </p>
      <div className="space-y-2">
        {products.flatMap((from) =>
          products
            .filter((to) => to.id !== from.id)
            .map((to) => {
              const key = `${from.id}->${to.id}`;
              const dist = value[from.id]?.[to.id];
              return (
                <div
                  key={key}
                  className="border-border bg-card/40 space-y-1.5 rounded-md border p-2"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-mono">
                      <span className="text-muted-foreground">{from.id}</span>
                      <span className="text-muted-foreground mx-1">→</span>
                      <span className="text-muted-foreground">{to.id}</span>
                    </span>
                    {dist ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${from.id} → ${to.id}`}
                        onClick={() => {
                          setCell(from.id, to.id, null);
                        }}
                        className="h-6 w-6"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCell(from.id, to.id, constant(60_000));
                        }}
                        className="h-6 px-2 text-[11px]"
                      >
                        Set time
                      </Button>
                    )}
                  </div>
                  {dist ? (
                    <DistributionField
                      value={dist}
                      onChange={(d) => {
                        setCell(from.id, to.id, d);
                      }}
                    />
                  ) : null}
                </div>
              );
            }),
        )}
      </div>
    </div>
  );
}
