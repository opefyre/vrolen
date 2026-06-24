/**
 * VROL-928 / VROL-929 — Sprint 92 row editors that replace the JSON
 * textareas shipped in Sprint 91. Owns three sub-editors:
 *   - requiredToolPool: dropdown of scenario-defined pool names + plain text
 *     fallback so users who reference a pool not yet declared can still type.
 *   - bomFeeders: rows of {feederStationId dropdown, qtyPerCycle number}.
 *   - perSkuRouting: one row per declared SKU with a destination dropdown
 *     ({default, skip, <other station id>}).
 */

import type { Node } from "@xyflow/react";
import { Button } from "@/components/ui/button";

interface ProductEntry {
  readonly id: string;
  readonly name: string;
  readonly weight: number;
}

interface ToolPool {
  readonly name: string;
  readonly capacity: number;
}

interface BomFeederRow {
  readonly feederStationId: string;
  readonly qtyPerCycle: number;
}

interface ConstraintsEditorProps {
  readonly node: Node;
  readonly otherNodes: ReadonlyArray<Node>;
  readonly toolPools: ReadonlyArray<ToolPool>;
  readonly productList: ReadonlyArray<ProductEntry>;
  readonly updateData: (patch: Record<string, unknown>) => void;
}

function nodeLabelOf(n: Node): string {
  const d = n.data as { label?: string } | undefined;
  return d?.label ?? n.id;
}

export function ConstraintsEditor({
  node,
  otherNodes,
  toolPools,
  productList,
  updateData,
}: ConstraintsEditorProps) {
  const data = node.data as {
    requiredToolPool?: string;
    bomFeeders?: ReadonlyArray<BomFeederRow>;
    perSkuRouting?: Record<string, string>;
  };
  const currentPool = data.requiredToolPool ?? "";
  const feeders = Array.isArray(data.bomFeeders) ? [...data.bomFeeders] : [];
  const routing: Record<string, string> = { ...(data.perSkuRouting ?? {}) };
  const poolKnown = toolPools.some((p) => p.name === currentPool);
  return (
    <div className="border-border space-y-3 rounded-md border border-dashed p-3">
      <div className="text-foreground text-xs font-medium">Shared constraints</div>
      <div className="flex flex-col gap-1">
        <label htmlFor="inspector-tool-pool" className="text-muted-foreground text-xs font-medium">
          Required tool pool
        </label>
        {toolPools.length > 0 ? (
          <select
            id="inspector-tool-pool"
            value={currentPool}
            onChange={(e) => {
              const v = e.target.value;
              updateData({ requiredToolPool: v.length > 0 ? v : undefined });
            }}
            className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
          >
            <option value="">None</option>
            {toolPools.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} (cap {String(p.capacity)})
              </option>
            ))}
            {currentPool.length > 0 && !poolKnown ? (
              <option value={currentPool}>{currentPool} (undeclared)</option>
            ) : null}
          </select>
        ) : (
          <input
            id="inspector-tool-pool"
            type="text"
            value={currentPool}
            onChange={(e) => {
              const v = e.target.value.trim();
              updateData({ requiredToolPool: v.length > 0 ? v : undefined });
            }}
            placeholder="e.g. chambers (declare in run settings → Tool pools)"
            className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
          />
        )}
        <p className="text-muted-foreground text-[11px]">
          Station holds one unit of this pool per cycle. Stations sharing a pool serialise.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground text-xs font-medium">BOM feeders</div>
        {feeders.length === 0 ? (
          <p className="text-muted-foreground text-[11px]">
            None. Add to require parts from upstream feeder stations per cycle.
          </p>
        ) : (
          feeders.map((f, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={f.feederStationId}
                onChange={(e) => {
                  const next = feeders.map((row, j) =>
                    j === idx ? { ...row, feederStationId: e.target.value } : row,
                  );
                  updateData({ bomFeeders: next.length > 0 ? next : undefined });
                }}
                className="border-input bg-background flex-1 rounded-md border px-2 py-1.5 text-sm"
              >
                <option value="">— feeder —</option>
                {otherNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {nodeLabelOf(n)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                value={f.qtyPerCycle}
                onChange={(e) => {
                  const v = Math.max(1, Math.floor(Number(e.target.value) || 1));
                  const next = feeders.map((row, j) =>
                    j === idx ? { ...row, qtyPerCycle: v } : row,
                  );
                  updateData({ bomFeeders: next });
                }}
                className="border-input bg-background w-16 rounded-md border px-2 py-1.5 text-sm"
                aria-label="qty per cycle"
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label="Remove feeder"
                onClick={() => {
                  const next = feeders.filter((_, j) => j !== idx);
                  updateData({ bomFeeders: next.length > 0 ? next : undefined });
                }}
              >
                ×
              </Button>
            </div>
          ))
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={otherNodes.length === 0}
          onClick={() => {
            const fallback = otherNodes[0]?.id ?? "";
            updateData({
              bomFeeders: [...feeders, { feederStationId: fallback, qtyPerCycle: 1 }],
            });
          }}
        >
          + Add feeder
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-muted-foreground text-xs font-medium">Per-SKU routing</div>
        {productList.length === 0 ? (
          <p className="text-muted-foreground text-[11px]">
            Enable Products in run settings to define per-SKU routing.
          </p>
        ) : (
          productList.map((p) => {
            const dest = routing[p.id] ?? "";
            return (
              <div key={p.id} className="flex items-center gap-2">
                <span className="text-muted-foreground w-24 truncate text-xs">{p.name}</span>
                <select
                  value={dest}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = { ...routing };
                    if (v === "") {
                      delete next[p.id];
                    } else {
                      next[p.id] = v;
                    }
                    updateData({
                      perSkuRouting: Object.keys(next).length > 0 ? next : undefined,
                    });
                  }}
                  className="border-input bg-background flex-1 rounded-md border px-2 py-1.5 text-sm"
                >
                  <option value="">Default (follow edges)</option>
                  <option value="skip">Skip to sink</option>
                  {otherNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      Route to {nodeLabelOf(n)}
                    </option>
                  ))}
                </select>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
