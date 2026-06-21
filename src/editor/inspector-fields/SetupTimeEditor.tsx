import { DistributionField } from "@/components/ui/distribution-field";
import { constant, type Distribution } from "@/engine";

interface SetupTimeEditorProps {
  readonly value: Distribution | null;
  readonly onChange: (d: Distribution | null) => void;
}

export function SetupTimeEditor({ value, onChange }: SetupTimeEditorProps) {
  const enabled = value !== null;
  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-3">
      <label className="flex items-center gap-2 text-xs font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            onChange(e.target.checked ? constant(100) : null);
          }}
          className="accent-sim-running h-4 w-4"
        />
        Setup / changeover time
      </label>
      {enabled ? (
        <DistributionField
          value={value}
          onChange={(d: Distribution) => {
            onChange(d);
          }}
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          When enabled, the station goes Idle → Setup → Running for each cycle.
        </p>
      )}
    </div>
  );
}
