/**
 * VROL-777 — Persistent run console pane.
 *
 * Sits at the bottom of the editor canvas. Captures every Run event,
 * validation outcome, simulation completion, error toast etc. so the
 * user has a scrollable history (not just the last sonner toast that
 * disappeared four seconds ago). Collapsed by default — single-row
 * status bar showing the latest line; expands to a 200-line buffer
 * with severity icons + timestamps + a "Copy as markdown" affordance.
 *
 * Persistence: in-memory only. Survives across runs within a session
 * but clears on reload — the console is for "what just happened",
 * not an audit trail.
 */

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Copy,
  Info,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

export type RunConsoleSeverity = "info" | "success" | "warning" | "error";

export interface RunConsoleEntry {
  readonly tMs: number;
  readonly clock: string;
  readonly severity: RunConsoleSeverity;
  readonly message: string;
  readonly description?: string;
  /**
   * VROL-910 — optional simulated time the entry is associated with.
   * When set, RunConsole hides the entry during playback while the
   * playhead is BEFORE this time (the event "hasn't happened yet").
   * Undefined entries always show — they're UI events, not sim events.
   */
  readonly simTimeMs?: number;
}

function stampClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

const MAX_ENTRIES = 200;

class RunConsoleStore {
  private entries: RunConsoleEntry[] = [];
  private listeners = new Set<() => void>();

  log(
    severity: RunConsoleSeverity,
    message: string,
    description?: string,
    simTimeMs?: number,
  ): void {
    const entry: RunConsoleEntry = {
      tMs: typeof performance !== "undefined" ? performance.now() : 0,
      clock: stampClock(),
      severity,
      message,
      ...(description ? { description } : {}),
      ...(typeof simTimeMs === "number" ? { simTimeMs } : {}),
    };
    this.entries = [...this.entries, entry].slice(-MAX_ENTRIES);
    this.listeners.forEach((l) => {
      l();
    });
  }

  clear(): void {
    this.entries = [];
    this.listeners.forEach((l) => {
      l();
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): readonly RunConsoleEntry[] {
    return this.entries;
  }
}

const STORE = new RunConsoleStore();

// eslint-disable-next-line react-refresh/only-export-components
export function logToRunConsole(
  severity: RunConsoleSeverity,
  message: string,
  description?: string,
  simTimeMs?: number,
): void {
  STORE.log(severity, message, description, simTimeMs);
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRunConsoleEntries(): readonly RunConsoleEntry[] {
  return useSyncExternalStore(
    (l) => STORE.subscribe(l),
    () => STORE.snapshot(),
    () => STORE.snapshot(),
  );
}

function SeverityIcon({ severity }: { readonly severity: RunConsoleSeverity }) {
  switch (severity) {
    case "success":
      return <Check className="text-sim-running h-3.5 w-3.5 shrink-0" aria-hidden />;
    case "error":
      return <CircleAlert className="text-sim-down-foreground h-3.5 w-3.5 shrink-0" aria-hidden />;
    case "warning":
      return (
        <AlertTriangle className="text-sim-setup-foreground h-3.5 w-3.5 shrink-0" aria-hidden />
      );
    case "info":
    default:
      return <Info className="text-muted-foreground h-3.5 w-3.5 shrink-0" aria-hidden />;
  }
}

export function RunConsole({
  playheadTimeMs,
}: {
  /** VROL-910 — when set, hides entries whose simTimeMs > playheadTimeMs.
   *  Entries without simTimeMs always show (UI/metadata events). */
  readonly playheadTimeMs?: number | null;
} = {}) {
  const allEntries = useRunConsoleEntries();
  const [expanded, setExpanded] = useState<boolean>(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  // VROL-910 — when a playhead is provided, hide sim-time-tagged entries
  // whose time is ahead of the playhead. UI/metadata entries (no simTimeMs)
  // pass through regardless so the "Run started" / "Simulation complete"
  // chrome remains visible.
  const entries =
    typeof playheadTimeMs === "number"
      ? allEntries.filter((e) => typeof e.simTimeMs !== "number" || e.simTimeMs <= playheadTimeMs)
      : allEntries;
  const hiddenCount = allEntries.length - entries.length;

  // Auto-scroll to the latest entry when expanded.
  useEffect(() => {
    if (!expanded) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [expanded, entries.length]);

  const latest = entries.at(-1);
  const errorCount = entries.filter((e) => e.severity === "error").length;
  const warningCount = entries.filter((e) => e.severity === "warning").length;

  const onCopyMarkdown = (): void => {
    const lines = entries.map((e) => {
      const sym =
        e.severity === "success"
          ? "✓"
          : e.severity === "error"
            ? "✗"
            : e.severity === "warning"
              ? "!"
              : "·";
      const desc = e.description ? ` — ${e.description}` : "";
      return `- \`${e.clock}\` ${sym} ${e.message}${desc}`;
    });
    const md = `## Run console\n\n${lines.join("\n")}\n`;
    void navigator.clipboard
      .writeText(md)
      .then(() => {
        toast.success("Run console copied as markdown");
      })
      .catch(() => {
        toast.error("Copy failed", { description: "Clipboard unavailable" });
      });
  };

  return (
    <section
      aria-label="Run console"
      className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 flex flex-col rounded-md border backdrop-blur"
    >
      <header className="flex items-center gap-2 px-2 py-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={expanded ? "Collapse run console" : "Expand run console"}
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((v) => !v);
          }}
          className="h-6 w-6"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </Button>
        <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
          Run console
        </span>
        <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
          {entries.length}/{MAX_ENTRIES}
        </span>
        {/* VROL-910 — small indicator when the console is filtering by playhead. */}
        {typeof playheadTimeMs === "number" && hiddenCount > 0 ? (
          <span
            className="bg-sim-running/15 text-sim-running rounded-full px-1.5 py-0.5 font-mono text-[11px]"
            title={`${String(hiddenCount)} entr${hiddenCount === 1 ? "y" : "ies"} hidden — playhead before their sim time`}
          >
            +{hiddenCount} after playhead
          </span>
        ) : null}
        {errorCount > 0 ? (
          <span
            className="bg-sim-down/15 text-sim-down-foreground rounded-full px-1.5 py-0.5 font-mono text-[11px]"
            title={`${String(errorCount)} error${errorCount === 1 ? "" : "s"}`}
          >
            {errorCount} err
          </span>
        ) : null}
        {warningCount > 0 ? (
          <span
            className="bg-sim-setup/20 text-sim-setup-foreground rounded-full px-1.5 py-0.5 font-mono text-[11px]"
            title={`${String(warningCount)} warning${warningCount === 1 ? "" : "s"}`}
          >
            {warningCount} warn
          </span>
        ) : null}
        {!expanded && latest ? (
          <div className="text-foreground/80 ml-2 flex min-w-0 items-center gap-1.5 text-[11px]">
            <SeverityIcon severity={latest.severity} />
            <span className="text-muted-foreground font-mono text-[11px] tabular-nums">
              {latest.clock}
            </span>
            <span className="truncate">{latest.message}</span>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopyMarkdown}
            disabled={entries.length === 0}
            className="h-6 gap-1 px-2 text-[11px]"
            aria-label="Copy run console as markdown"
          >
            <Copy className="h-3 w-3" aria-hidden />
            Copy
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              STORE.clear();
            }}
            disabled={entries.length === 0}
            className="h-6 gap-1 px-2 text-[11px]"
            aria-label="Clear run console"
          >
            <Trash2 className="h-3 w-3" aria-hidden />
            Clear
          </Button>
        </div>
      </header>
      {expanded ? (
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="border-border max-h-44 overflow-y-auto border-t"
        >
          {entries.length === 0 ? (
            <p className="text-muted-foreground px-3 py-3 text-[11px]">
              Run logs land here. Hit Run to see validation, sim progress, and KPIs in one place.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {entries.map((e, i) => (
                <li
                  key={`${String(e.tMs)}-${String(i)}`}
                  className="flex items-start gap-2 px-3 py-1.5 text-[11px]"
                >
                  <span className="text-muted-foreground mt-0.5 font-mono text-[11px] tabular-nums">
                    {e.clock}
                  </span>
                  <SeverityIcon severity={e.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground/90">{e.message}</div>
                    {e.description ? (
                      <div className="text-muted-foreground mt-0.5">{e.description}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
