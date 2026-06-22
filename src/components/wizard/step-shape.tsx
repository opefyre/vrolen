/**
 * Step 1 — pick a starting topology.
 *
 * VROL-871 — rebuilt to expose four shape kinds (single line / two
 * parallel lines / branching DAG / custom blank) instead of three named
 * presets. The picker also resets the station + connection lists to the
 * preset's defaults so the user can fast-forward by clicking Next.
 *
 * VROL-821 — no silent preselect. The draft starts with `shapeKind === null`
 * so the four cards render without a selected ring; Next stays disabled
 * (via `validateShape`) until the user clicks one. The pick is mirrored
 * to `sessionStorage` under `vrolen:wizard-shape-resume` so a mid-wizard
 * reload restores it without touching the localStorage draft path (which
 * is the Save-&-exit storage).
 */

import { Check, GitBranch, Layers, Square, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect } from "react";

import { FieldError } from "./field-error";
import { SHAPE_PRESETS, type ShapeKind, type WizardDraft } from "./wizard-types";

const SHAPE_ICONS: Record<ShapeKind, LucideIcon> = {
  "single-line": Workflow,
  "two-lines": Layers,
  branching: GitBranch,
  custom: Square,
};

/** VROL-821 — sessionStorage key for the resume-pick. Scoped per-tab so a
 *  fresh tab starts unselected even if another tab is mid-wizard. */
export const SHAPE_RESUME_KEY = "vrolen:wizard-shape-resume";

const VALID_KINDS: readonly ShapeKind[] = ["single-line", "two-lines", "branching", "custom"];

function readResumeShape(): ShapeKind | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage?.getItem?.(SHAPE_RESUME_KEY);
    if (raw === null || raw === undefined) return null;
    return VALID_KINDS.includes(raw as ShapeKind) ? (raw as ShapeKind) : null;
  } catch {
    return null;
  }
}

function writeResumeShape(kind: ShapeKind): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem?.(SHAPE_RESUME_KEY, kind);
  } catch {
    // best-effort
  }
}

export function StepShape({
  draft,
  update,
  errors,
}: {
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly errors?: Readonly<Record<string, string>>;
}) {
  const shapeError = errors?.["shapeKind"];
  /** VROL-821 — restore from sessionStorage on mount when the live draft
   *  has no pick yet. Runs exactly once per mount; subsequent edits
   *  flow through the click handler below. */
  useEffect(() => {
    if (draft.shapeKind !== null) return;
    const resumed = readResumeShape();
    if (!resumed) return;
    const preset = SHAPE_PRESETS.find((p) => p.kind === resumed);
    if (!preset) return;
    const stations = preset.buildStations();
    const connections = preset.buildConnections(stations);
    update({ shapeKind: resumed, stations, connections });
    // We intentionally only run this on mount — the rehydrate is a
    // one-shot. Reading draft.shapeKind on every render would clobber
    // user interactions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Pick the shape closest to your line. You can rename stations, change cycle times, and rewire
        the topology in later steps.
      </p>
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="radiogroup"
        aria-label="Starting shape"
        aria-invalid={shapeError ? true : undefined}
      >
        {SHAPE_PRESETS.map((preset) => {
          const Icon = SHAPE_ICONS[preset.kind] ?? Square;
          const isSelected = draft.shapeKind === preset.kind;
          return (
            <button
              key={preset.kind}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-testid={`shape-card-${preset.kind}`}
              onClick={() => {
                const stations = preset.buildStations();
                const connections = preset.buildConnections(stations);
                update({ shapeKind: preset.kind, stations, connections });
                writeResumeShape(preset.kind);
              }}
              className={`group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all ${
                isSelected
                  ? "border-sim-running bg-sim-running/5 ring-sim-running/30 ring-2"
                  : "border-border bg-card hover:border-foreground/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-md ${
                    isSelected
                      ? "bg-sim-running/15 text-sim-running"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {isSelected ? (
                  <span className="text-sim-running flex items-center gap-1 text-[10px] font-medium tracking-wide uppercase">
                    <Check className="h-3 w-3" />
                    Selected
                  </span>
                ) : null}
              </div>
              <div className="space-y-0.5">
                <div className="font-heading text-sm font-semibold">{preset.title}</div>
                <div className="text-muted-foreground text-xs leading-relaxed">{preset.blurb}</div>
              </div>
              <ShapePreview kind={preset.kind} />
            </button>
          );
        })}
      </div>
      <FieldError message={shapeError} />
    </div>
  );
}

/**
 * Mini SVG preview of the shape. Pure visual cue — sized to 180x48 so it
 * fits comfortably under the card title even on a narrow modal.
 */
function ShapePreview({ kind }: { readonly kind: ShapeKind }) {
  const w = 180;
  const h = 48;
  const dot = (x: number, y: number) => (
    <circle cx={x} cy={y} r={6} fill="var(--primary)" stroke="var(--border)" strokeWidth={1} />
  );
  const line = (x1: number, y1: number, x2: number, y2: number) => (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="var(--muted-foreground)"
      strokeWidth={1.4}
      markerEnd="url(#wiz-shape-arrow)"
    />
  );
  return (
    <svg
      role="img"
      aria-label={`${kind} preview`}
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      width={w}
      height={h}
      className="block"
    >
      <defs>
        <marker
          id="wiz-shape-arrow"
          viewBox="0 0 8 8"
          refX={6}
          refY={4}
          markerWidth={5}
          markerHeight={5}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {kind === "single-line"
        ? [
            line(20, 24, 60, 24),
            line(60, 24, 110, 24),
            line(110, 24, 160, 24),
            <g key="d">{[20, 60, 110, 160].map((x) => dot(x, 24))}</g>,
          ]
        : null}
      {kind === "two-lines"
        ? [
            line(20, 12, 70, 12),
            line(70, 12, 130, 24),
            line(20, 36, 70, 36),
            line(70, 36, 130, 24),
            <g key="d">
              {dot(20, 12)}
              {dot(70, 12)}
              {dot(20, 36)}
              {dot(70, 36)}
              {dot(130, 24)}
            </g>,
          ]
        : null}
      {kind === "branching"
        ? [
            line(20, 24, 70, 12),
            line(20, 24, 70, 36),
            line(70, 12, 130, 24),
            line(70, 36, 130, 24),
            <g key="d">
              {dot(20, 24)}
              {dot(70, 12)}
              {dot(70, 36)}
              {dot(130, 24)}
            </g>,
          ]
        : null}
      {kind === "custom" ? <g>{dot(90, 24)}</g> : null}
    </svg>
  );
}
