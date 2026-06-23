/**
 * VROL-833 — Persistent sync-status pill in the editor toolbar.
 *
 * Three states drive a colored dot + label:
 *   • green  — scenario named AND no drift vs last save
 *   • amber  — scenario named AND drift (unsaved changes)
 *   • muted  — scenario has no name yet (Cmd+S would prompt)
 *
 * Wrapped in a native <details> popover that shows:
 *   • last-saved relative time (auto-updates each second while open)
 *   • a Save now button (calls onSaveNow)
 *   • a Restore button when there are unsaved changes (calls onRestore)
 *
 * Replaces the prior "modified" chip (VROL-774) — same diff info, plus the
 * actionable controls users always reach for next.
 */

import { useEffect, useState } from "react";

interface SyncDiff {
  readonly nodeChanges: number;
  readonly edgeChanges: number;
  readonly settingsChanges: number;
}

interface SyncStatusPillProps {
  readonly scenarioName: string | null;
  readonly isModified: boolean;
  readonly diff: SyncDiff | null;
  readonly lastSavedAtMs: number | null;
  readonly onSaveNow: () => void;
  readonly onRestore: () => void;
}

function formatRelative(ms: number, now: number): string {
  const delta = Math.max(0, now - ms);
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SyncStatusPill({
  scenarioName,
  isModified,
  diff,
  lastSavedAtMs,
  onSaveNow,
  onRestore,
}: SyncStatusPillProps) {
  // Tick once per second while the popover is open so the relative time
  // updates. Driven by <details>'s open state.
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, [open]);

  let dotClass: string;
  let label: string;
  let tone: string;
  if (!scenarioName) {
    dotClass = "bg-sim-down";
    label = "Not saved";
    tone = "text-sim-down-foreground bg-sim-down/10";
  } else if (isModified) {
    dotClass = "bg-sim-setup";
    label = diff
      ? `Unsaved · ${String(diff.nodeChanges + diff.edgeChanges + diff.settingsChanges)} Δ`
      : "Unsaved";
    tone = "text-sim-setup-foreground bg-sim-setup/15";
  } else {
    dotClass = "bg-sim-running";
    label = "Saved";
    tone = "text-sim-running bg-sim-running/10";
  }

  return (
    <details
      className="relative"
      onToggle={(e) => {
        setOpen((e.currentTarget as HTMLDetailsElement).open);
      }}
    >
      <summary
        className={`focus-visible:ring-foreground/40 inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium focus-visible:ring-2 focus-visible:outline-none ${tone}`}
        aria-label={`${label} — open sync details`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
        {label}
      </summary>
      <div
        role="dialog"
        aria-label="Sync details"
        className="border-border bg-card text-foreground absolute top-full left-0 z-30 mt-1 w-64 rounded-md border p-3 text-xs shadow-lg"
      >
        <div className="space-y-2">
          <div>
            <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
              {scenarioName ? "Scenario" : "Unsaved scenario"}
            </div>
            <div className="text-foreground font-medium">{scenarioName ?? "Untitled"}</div>
          </div>
          {lastSavedAtMs ? (
            <div>
              <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
                Last saved
              </div>
              <div className="font-mono tabular-nums">{formatRelative(lastSavedAtMs, now)}</div>
            </div>
          ) : null}
          {isModified && diff ? (
            <div className="text-muted-foreground border-border border-t pt-2">
              {diff.nodeChanges > 0
                ? `${String(diff.nodeChanges)} node${diff.nodeChanges === 1 ? "" : "s"}`
                : null}
              {diff.nodeChanges > 0 && (diff.edgeChanges > 0 || diff.settingsChanges > 0)
                ? " · "
                : null}
              {diff.edgeChanges > 0
                ? `${String(diff.edgeChanges)} edge${diff.edgeChanges === 1 ? "" : "s"}`
                : null}
              {diff.edgeChanges > 0 && diff.settingsChanges > 0 ? " · " : null}
              {diff.settingsChanges > 0
                ? `${String(diff.settingsChanges)} setting${diff.settingsChanges === 1 ? "" : "s"}`
                : null}{" "}
              changed
            </div>
          ) : null}
          <div className="border-border flex items-center gap-2 border-t pt-2">
            <button
              type="button"
              onClick={onSaveNow}
              className="bg-foreground text-background hover:bg-foreground/85 inline-flex items-center rounded-md px-2 py-1 text-[11px] font-medium"
            >
              Save now
            </button>
            {scenarioName && isModified ? (
              <button
                type="button"
                onClick={onRestore}
                className="border-border text-foreground hover:bg-accent inline-flex items-center rounded-md border px-2 py-1 text-[11px]"
              >
                Restore
              </button>
            ) : null}
          </div>
          {!scenarioName ? (
            <p className="text-muted-foreground text-[10px]">
              Save now to name this scenario. Cmd+S also opens the name dialog.
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
