/**
 * Step 3 — author the connection list.
 *
 * VROL-871 — the previous wizard hard-coded a linear chain so users
 * couldn't author branching or merging topologies. This step exposes
 * every edge as a source → target row, with a live mini-DAG preview
 * + inline guardrails (engine requires a single source and a single
 * sink).
 */

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { FieldError } from "./field-error";
import type { WizardConnection, WizardDraft, WizardStation } from "./wizard-types";

export function StepConnections({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const sourceError = errors?.["sources"];
  const sinkError = errors?.["sinks"];
  const addEdge = () => {
    const first = draft.stations[0];
    const second = draft.stations[1] ?? first;
    if (!first || !second) return;
    const id = `e_${Math.random().toString(36).slice(2, 8)}`;
    update({
      connections: [...draft.connections, { id, sourceId: first.id, targetId: second.id }],
    });
  };
  const removeEdge = (idx: number) => {
    update({ connections: draft.connections.filter((_, i) => i !== idx) });
  };
  const updateEdge = (idx: number, patch: Partial<WizardConnection>) => {
    update({
      connections: draft.connections.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
    });
  };
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Wire the stations together. The simulator runs on a single source and a single sink — pick
        the starting station and the ending station, then add any branches in between.
      </p>
      <div className="space-y-2">
        {draft.connections.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            No connections yet. Add at least one to flow items between stations.
          </p>
        ) : (
          draft.connections.map((e, idx) => {
            const edgeError = errors?.[`edge-${String(idx)}`];
            return (
              <div
                key={e.id}
                className={`border-border bg-background/40 grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-md border p-2 ${
                  edgeError ? "border-sim-down/60" : ""
                }`}
              >
                <StationSelect
                  id={`edge-${String(idx)}-source`}
                  label="From"
                  value={e.sourceId}
                  stations={draft.stations}
                  onChange={(v) => {
                    updateEdge(idx, { sourceId: v });
                  }}
                />
                <span className="text-muted-foreground text-xs">→</span>
                <StationSelect
                  id={`edge-${String(idx)}-target`}
                  label="To"
                  value={e.targetId}
                  stations={draft.stations}
                  onChange={(v) => {
                    updateEdge(idx, { targetId: v });
                  }}
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    removeEdge(idx);
                  }}
                  aria-label={`Remove connection ${String(idx + 1)}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                {edgeError ? <FieldError message={edgeError} /> : null}
              </div>
            );
          })
        )}
      </div>
      <Button size="sm" variant="outline" onClick={addEdge} className="gap-1">
        <Plus className="h-3.5 w-3.5" />
        Add connection
      </Button>
      <FieldError message={sourceError} />
      <FieldError message={sinkError} />
      <DagPreview stations={draft.stations} connections={draft.connections} />
    </div>
  );
}

function StationSelect({
  id,
  label,
  value,
  stations,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly stations: readonly WizardStation[];
  readonly onChange: (next: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-[10px] font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className="border-input bg-background h-8 w-full rounded-md border px-2 text-xs"
      >
        {stations.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Compact column-based DAG preview. Stations are placed left→right in
 * topological order; vertical stacking distributes parallel branches.
 */
function DagPreview({
  stations,
  connections,
}: {
  readonly stations: readonly WizardStation[];
  readonly connections: readonly WizardConnection[];
}) {
  if (stations.length === 0) return null;
  const w = 360;
  const h = 140;
  const padding = 22;
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
  const visit: string[] = [];
  stations.forEach((s) => {
    if ((incoming.get(s.id) ?? []).length === 0) {
      col.set(s.id, 0);
      visit.push(s.id);
    }
  });
  while (visit.length > 0) {
    const cur = visit.shift();
    if (!cur) break;
    const curCol = col.get(cur) ?? 0;
    (outgoing.get(cur) ?? []).forEach((next) => {
      const prev = col.get(next);
      const candidate = curCol + 1;
      if (prev === undefined || candidate > prev) col.set(next, candidate);
      visit.push(next);
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
  const columns = [...byColumn.keys()].sort((a, b) => a - b);
  const maxCol = columns[columns.length - 1] ?? 0;
  const colStride = maxCol === 0 ? 0 : (w - padding * 2) / Math.max(1, maxCol);
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((c) => {
    const list = byColumn.get(c) ?? [];
    const stride = (h - padding * 2) / Math.max(1, list.length);
    list.forEach((id, idx) => {
      pos.set(id, {
        x: padding + c * colStride,
        y: padding + stride * idx + stride / 2,
      });
    });
  });
  const radius = 8;
  return (
    <div className="border-border bg-background/40 rounded-md border p-2">
      <div className="text-muted-foreground mb-1 text-[10px] font-medium tracking-wide uppercase">
        Preview
      </div>
      <svg
        role="img"
        aria-label="Connection preview"
        viewBox={`0 0 ${String(w)} ${String(h)}`}
        className="w-full"
      >
        <defs>
          <marker
            id="wiz-conn-arrow"
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
              strokeWidth={1.4}
              markerEnd="url(#wiz-conn-arrow)"
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
    </div>
  );
}
