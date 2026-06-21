import { DistributionField } from "@/components/ui/distribution-field";
import { constant, type Distribution } from "@/engine";

interface PerProductCyclesEditorProps {
  readonly products: readonly { id: string; name: string; weight: number }[];
  readonly value: Record<string, Distribution>;
  readonly onChange: (next: Record<string, Distribution>) => void;
}

export function PerProductCyclesEditor({ products, value, onChange }: PerProductCyclesEditorProps) {
  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-3">
      <div className="text-xs font-medium">Per-product cycle overrides</div>
      <p className="text-muted-foreground text-xs">Overrides default cycle time per product.</p>
      {products.map((p) => {
        const enabled = p.id in value;
        const dist = value[p.id];
        return (
          <div key={p.id} className="border-border space-y-2 rounded-md border p-2">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  if (e.target.checked) {
                    onChange({ ...value, [p.id]: constant(100) });
                  } else {
                    const next = { ...value };
                    delete next[p.id];
                    onChange(next);
                  }
                }}
                className="accent-sim-running h-4 w-4"
              />
              <span>
                {p.id} <span className="text-muted-foreground">— {p.name}</span>
              </span>
            </label>
            {enabled && dist ? (
              <DistributionField
                value={dist}
                onChange={(d: Distribution) => {
                  onChange({ ...value, [p.id]: d });
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
