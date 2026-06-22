/**
 * Step 8 — review + commit.
 *
 * VROL-871 — two-column review:
 *   - Left: summary list with "Tweak section" jumps back to the right step.
 *   - Right: mini-DAG showing the authored graph (single source/sink hinted).
 *   - Bottom: validation summary rolling up every upstream validator. The
 *     wizard shell already gates Next on validateReview, but surfacing
 *     errors here lets the user fix them inline.
 */

import { AlertTriangle, CheckCircle2, Pencil } from "lucide-react";

import { meanOf } from "@/engine";

import { STEP_VALIDATORS, type WizardDraft } from "./wizard-types";

function fmtHorizon(ms: number): string {
  const h = ms / (60 * 60 * 1000);
  if (h < 1) return `${(ms / (60 * 1000)).toFixed(0)} min`;
  if (h < 24) return `${h.toFixed(0)} hours`;
  return `${(h / 24).toFixed(0)} days`;
}

interface ReviewLineSpec {
  readonly label: string;
  readonly value: string;
  /** Step index to jump back to. */
  readonly stepIdx: number;
  readonly testId: string;
}

const STEP_LABELS = [
  "Shape",
  "Stations",
  "Connections",
  "Products",
  "Realism",
  "Arrivals",
  "Run window",
] as const;

export function StepReview({
  draft,
  onJump,
}: {
  readonly draft: WizardDraft;
  readonly onJump: (idx: number) => void;
}) {
  const reps = draft.runWindow.replications;
  const arrivalsLabel = draft.arrivals.enabled
    ? `1 / ${String(Math.round(meanOf(draft.arrivals.interArrivalDist)))} ms`
    : "Off";
  const productsLabel = draft.productsEnabled
    ? `${String(draft.products.length)} products`
    : "Single part";
  const lines: readonly ReviewLineSpec[] = [
    {
      label: "Topology",
      value: draft.shapeKind ? draft.shapeKind.replace("-", " ") : "—",
      stepIdx: 0,
      testId: "review-shape",
    },
    {
      label: "Stations",
      value: String(draft.stations.length),
      stepIdx: 1,
      testId: "review-stations",
    },
    {
      label: "Connections",
      value: String(draft.connections.length),
      stepIdx: 2,
      testId: "review-connections",
    },
    {
      label: "Products",
      value: productsLabel,
      stepIdx: 3,
      testId: "review-products",
    },
    {
      label: "Breakdowns",
      value: draft.breakdowns.enabled ? "Stochastic" : "Off",
      stepIdx: 4,
      testId: "review-realism",
    },
    {
      label: "Source",
      value: arrivalsLabel,
      stepIdx: 5,
      testId: "review-arrivals",
    },
    {
      label: "Run length",
      value: fmtHorizon(draft.runWindow.horizonMs),
      stepIdx: 6,
      testId: "review-horizon",
    },
    {
      label: "Replications",
      value: String(reps),
      stepIdx: 6,
      testId: "review-replications",
    },
  ];
  // Walk every upstream validator to surface aggregate problems.
  const upstream = STEP_VALIDATORS.slice(0, -1).map((v) => v(draft));
  const issues = upstream.filter((v) => !v.valid);
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Review the scenario, then hit <strong>Create scenario</strong> to mount it in the editor.
      </p>
      <div className="border-border bg-background/40 grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            Summary
          </div>
          <ul className="divide-border divide-y">
            {lines.map((line) => (
              <li
                key={line.label}
                data-testid={line.testId}
                className="flex items-center justify-between gap-3 py-1.5 text-sm"
              >
                <span className="text-muted-foreground">{line.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-foreground font-mono capitalize tabular-nums">
                    {line.value}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(line.stepIdx);
                    }}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[11px] underline-offset-2 hover:underline"
                    aria-label={`Tweak ${line.label.toLowerCase()}`}
                  >
                    <Pencil className="h-2.5 w-2.5" aria-hidden />
                    Tweak section
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-center sm:justify-end">
          <MiniDag draft={draft} />
        </div>
      </div>
      <div
        className={`border-border space-y-1 rounded-md border p-3 text-sm ${
          issues.length === 0 ? "bg-sim-running/5" : "bg-sim-down/5"
        }`}
      >
        {issues.length === 0 ? (
          <div className="text-sim-running flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>Looks good — scenario is ready to commit.</span>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="text-sim-down flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              <span>{issues.length} step(s) still need attention.</span>
            </div>
            <ul className="space-y-0.5 text-xs">
              {issues.map((v) => (
                <li key={v.step}>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(v.step);
                    }}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  >
                    Step {String(v.step + 1)} · {STEP_LABELS[v.step] ?? "(step)"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * VROL-871 — mini-DAG echoing the connection editor's preview. Uses the
 * same column-based layout so review feels consistent with step 3.
 */
function MiniDag({ draft }: { readonly draft: WizardDraft }) {
  const stations = draft.stations;
  const connections = draft.connections;
  const width = 220;
  const height = 96;
  const padding = 16;
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  stations.forEach((s) => {
    incoming.set(s.id, []);
    outgoing.set(s.id, []);
  });
  connections.forEach((e) => {
    incoming.get(e.targetId)?.push(e.sourceId);
    outgoing.get(e.sourceId)?.push(e.targetId);
  });
  const col = new Map<string, number>();
  const queue: string[] = [];
  stations.forEach((s) => {
    if ((incoming.get(s.id) ?? []).length === 0) {
      col.set(s.id, 0);
      queue.push(s.id);
    }
  });
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const curCol = col.get(cur) ?? 0;
    (outgoing.get(cur) ?? []).forEach((next) => {
      const prev = col.get(next);
      const candidate = curCol + 1;
      if (prev === undefined || candidate > prev) col.set(next, candidate);
      queue.push(next);
    });
  }
  stations.forEach((s) => {
    if (!col.has(s.id)) col.set(s.id, 0);
  });
  const byColumn = new Map<number, string[]>();
  stations.forEach((s) => {
    const c = col.get(s.id) ?? 0;
    const list = byColumn.get(c) ?? [];
    list.push(s.id);
    byColumn.set(c, list);
  });
  const cols = [...byColumn.keys()].sort((a, b) => a - b);
  const maxCol = cols[cols.length - 1] ?? 0;
  const stride = maxCol === 0 ? 0 : (width - padding * 2) / Math.max(1, maxCol);
  const pos = new Map<string, { x: number; y: number }>();
  cols.forEach((c) => {
    const list = byColumn.get(c) ?? [];
    const yStride = (height - padding * 2) / Math.max(1, list.length);
    list.forEach((id, idx) => {
      pos.set(id, {
        x: padding + c * stride,
        y: padding + yStride * idx + yStride / 2,
      });
    });
  });
  const radius = 8;
  return (
    <svg
      role="img"
      aria-label={`Mini topology with ${String(stations.length)} ${
        stations.length === 1 ? "station" : "stations"
      }`}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      className="block"
    >
      <defs>
        <marker
          id="vrolen-wizard-dag-arrow"
          viewBox="0 0 8 8"
          refX={6}
          refY={4}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {connections.map((e, i) => {
        const a = pos.get(e.sourceId);
        const b = pos.get(e.targetId);
        if (!a || !b) return null;
        return (
          <line
            key={`edge-${String(i)}`}
            x1={a.x + radius}
            y1={a.y}
            x2={b.x - radius}
            y2={b.y}
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            markerEnd="url(#vrolen-wizard-dag-arrow)"
          />
        );
      })}
      {stations.map((s, i) => {
        const p = pos.get(s.id);
        if (!p) return null;
        return (
          <g key={s.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r={radius}
              fill="var(--primary)"
              stroke="var(--border)"
              strokeWidth={1.5}
            />
            <text
              x={p.x}
              y={p.y + 3}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="var(--primary-foreground)"
            >
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
