import { ArrowRight, Clock, FlaskConical, Layers, Workflow } from "lucide-react";

import type { WizardDraft } from "./wizard-types";

function fmtHorizon(ms: number): string {
  const h = ms / (60 * 60 * 1000);
  if (h < 1) return `${(ms / (60 * 1000)).toFixed(0)} min`;
  if (h < 24) return `${h.toFixed(0)} hours`;
  return `${(h / 24).toFixed(0)} days`;
}

export function StepReview({ draft }: { readonly draft: WizardDraft }) {
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Hit <strong>Run simulation</strong> and we&rsquo;ll show you throughput, bottlenecks, and
        OEE in about 2 seconds.
      </p>
      <div className="border-border bg-background/40 rounded-md border p-3">
        <div className="text-muted-foreground mb-2 text-[10px] font-medium tracking-wide uppercase">
          Topology
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {draft.stations.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5">
              <span className="border-border bg-card rounded-md border px-2 py-1 text-xs font-medium">
                {s.label}
                <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                  {Math.round(s.cycleMs)}ms
                </span>
              </span>
              {i < draft.stations.length - 1 ? (
                <ArrowRight className="text-muted-foreground/50 h-3 w-3" aria-hidden />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          icon={<Layers className="h-3.5 w-3.5" />}
          label="Stations"
          value={String(draft.stations.length)}
        />
        <Tile
          icon={<Workflow className="h-3.5 w-3.5" />}
          label="Source rate"
          value={`${draft.arrivalsPerMin.toFixed(0)}/min`}
        />
        <Tile
          icon={<Clock className="h-3.5 w-3.5" />}
          label="Run length"
          value={fmtHorizon(draft.horizonMs)}
        />
        <Tile
          icon={<FlaskConical className="h-3.5 w-3.5" />}
          label="Realism"
          value={draft.realism.charAt(0).toUpperCase() + draft.realism.slice(1)}
        />
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="border-border bg-background/40 rounded-md border p-2.5">
      <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
        {icon}
        {label}
      </div>
      <div className="text-foreground mt-1 truncate text-sm font-semibold">{value}</div>
    </div>
  );
}
