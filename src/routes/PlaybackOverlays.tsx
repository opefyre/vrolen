/**
 * VROL-1190 + VROL-1192 + VROL-1193 (Sprint 201) — DOM overlays that
 * sit above the iso canvas: station KPI drawer (click-to-open), key
 * shortcut cheat sheet, and the replay-mode banner.
 *
 * All three live in one module to keep the IsoPlaybackView shell
 * from ballooning. Each is independently toggleable and pure
 * presentation — the parent owns the state.
 */

import type { ChainResult } from "@/engine";

interface CheatRow {
  readonly key: string;
  readonly action: string;
}
const SHORTCUTS: readonly CheatRow[] = [
  { key: "F", action: "Focus bottleneck" },
  { key: "?", action: "Toggle this cheat sheet" },
  { key: "Escape", action: "Close overlays" },
  { key: "drag", action: "Pan the camera" },
  { key: "wheel", action: "Zoom cursor-anchored" },
];

export function PlaybackReplayBanner({
  hasResult,
  isLive,
}: {
  readonly hasResult: boolean;
  readonly isLive: boolean;
}) {
  if (!hasResult || isLive) return null;
  return (
    <div
      className="border-sim-running/40 bg-sim-running/5 text-foreground/80 absolute inset-x-0 top-0 z-10 border-b px-3 py-1.5 text-center text-[11px] backdrop-blur"
      data-testid="playback-replay-banner"
      role="status"
    >
      Showing steady-state from last run — press{" "}
      <kbd className="bg-muted mx-0.5 rounded px-1 text-[10px] font-medium">Play</kbd> in the editor
      to watch it unfold.
    </div>
  );
}

export function PlaybackCheatSheet({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center"
      role="dialog"
      aria-modal
      aria-label="Keyboard shortcuts"
      data-testid="playback-cheat-sheet"
    >
      <button
        type="button"
        aria-label="Close keyboard shortcuts"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40 backdrop-blur-sm"
        data-testid="playback-cheat-sheet-backdrop"
      />
      <div className="border-border bg-card relative w-80 max-w-[85vw] space-y-2 rounded-md border p-4 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h3 className="text-foreground font-heading text-sm font-semibold">Keyboard shortcuts</h3>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground text-xs"
            onClick={onClose}
            data-testid="playback-cheat-sheet-close"
          >
            Esc
          </button>
        </div>
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.key} className="flex items-center gap-2 text-xs">
              <kbd className="bg-muted text-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold">
                {s.key}
              </kbd>
              <span className="text-foreground/80">{s.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface StationKpiPanelProps {
  readonly stationId: string | null;
  readonly stationLabel: string | null;
  readonly result: ChainResult | null;
  readonly topologyIndex: number | null;
  readonly onClose: () => void;
}

export function PlaybackStationKpiPanel({
  stationId,
  stationLabel,
  result,
  topologyIndex,
  onClose,
}: StationKpiPanelProps) {
  if (stationId === null) return null;
  const idx = topologyIndex;
  const runningPct = idx !== null ? result?.perStationRunningPct?.[idx] : undefined;
  const oee = idx !== null ? result?.perStationOee?.[idx] : undefined;
  const completed = idx !== null ? result?.perStationCompleted?.[idx] : undefined;
  const scrapped = idx !== null ? result?.perStationScrapped?.[idx] : undefined;
  const fmtPct = (v: number | undefined) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
  const fmtN = (v: number | undefined) => (v === undefined ? "—" : v.toLocaleString());
  return (
    <aside
      className="border-border bg-card absolute top-3 right-3 z-20 w-72 space-y-2 rounded-md border p-3 shadow-md"
      role="dialog"
      aria-label="Station KPIs"
      data-testid="playback-station-kpi"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-foreground font-heading text-sm font-semibold">
          {stationLabel ?? stationId}
        </h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground text-xs"
          onClick={onClose}
          data-testid="playback-station-kpi-close"
        >
          Esc
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Utilization</dt>
        <dd className="font-mono tabular-nums">{fmtPct(runningPct)}</dd>
        <dt className="text-muted-foreground">Availability</dt>
        <dd className="font-mono tabular-nums">{fmtPct(oee?.availability)}</dd>
        <dt className="text-muted-foreground">Performance</dt>
        <dd className="font-mono tabular-nums">{fmtPct(oee?.performance)}</dd>
        <dt className="text-muted-foreground">Quality</dt>
        <dd className="font-mono tabular-nums">{fmtPct(oee?.quality)}</dd>
        <dt className="text-muted-foreground">OEE</dt>
        <dd className="font-mono tabular-nums">{fmtPct(oee?.oee)}</dd>
        <dt className="text-muted-foreground">Completed</dt>
        <dd className="font-mono tabular-nums">{fmtN(completed)}</dd>
        <dt className="text-muted-foreground">Scrapped</dt>
        <dd className="font-mono tabular-nums">{fmtN(scrapped)}</dd>
      </dl>
    </aside>
  );
}
