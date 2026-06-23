/**
 * /editor — scenario authoring canvas.
 *
 * - VROL-262/265: react-flow canvas with a station palette on the left.
 * - VROL-577: graph → runChain translation + a Run button that executes
 *   the simulation and surfaces a KPI strip below the canvas.
 * - VROL-578: side inspector panel that opens on node click — edit label,
 *   cycle time, defect rate.
 *
 * Graph state persists to localStorage so reloads keep the user's last graph.
 * Only linear chains are runnable for now (chain harness limitation); the
 * translator (graphToChainOptions) picks the longest linear path and toasts
 * about anything it skipped.
 */
import "@xyflow/react/dist/style.css";

import {
  Background,
  BackgroundVariant,
  type Connection,
  ConnectionMode,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeChange,
  type EdgeChange,
  type NodeProps,
  type OnConnect,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useReactFlow,
  useStore,
  useViewport,
} from "@xyflow/react";
import {
  Boxes,
  CheckCircle2,
  CircleDot,
  Combine,
  ConciergeBell,
  Sparkles,
  Download,
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  Factory,
  Frame as FrameIcon,
  Redo2,
  Repeat,
  RotateCcw,
  Undo2,
  FolderOpen,
  HelpCircle,
  Hourglass,
  Loader2,
  Lock as LockIcon,
  MoreHorizontal,
  Package,
  PackageCheck,
  Play,
  Save,
  Settings2,
  StickyNote,
  Tag,
  Trash2,
  Truck,
  Wand2,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Accordion, AccordionStatus } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CapacityChip } from "@/components/canvas/capacity-chip";
import { DistributionField } from "@/components/ui/distribution-field";
import { DurationInput } from "@/components/ui/duration-input";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  addComparison,
  type ComparisonEntry,
  listComparisons,
  removeComparison,
} from "@/lib/comparison-history";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  asResourceId,
  type ChainBreakdownConfig,
  type ChainMaintenanceConfig,
  type ChainMaterialConfig,
  type ChainOptions,
  type ChainProductsConfig,
  type ChainResult,
  type ChainWorkerConfig,
  constant,
  type Distribution,
  runChain,
  SeededPrng,
} from "@/engine";
import { settingsToMaterialsCfg } from "@/lib/settings-to-materials-cfg";
import {
  chainResultToCsv,
  chainResultToJsonString,
  downloadFile,
  suggestedFilenameStem,
} from "@/lib/export-run";
// VROL-683 — line + station summary CSV (separate from per-station-only export-run).
import { resultToCsv as resultToSummaryCsv } from "@/lib/result-to-csv";
import { graphToChainOptions } from "@/lib/graph-to-chain";
import {
  addRun as addRunToHistory,
  listRuns as listRunHistory,
  type RunHistoryEntry,
  type RunHistoryEntryWithScenario,
} from "@/lib/run-history";
import { consumePendingPreset, PRESETS, type Preset } from "@/lib/presets";
import { takePendingWizardCommit } from "@/lib/wizard-handoff";
import { commitDraft as commitWizardDraft } from "@/components/wizard/commit-draft";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { runScenario, type ScenarioRunOutcome } from "@/lib/run-scenario";
import {
  defineActions,
  type EditorAction,
  type EditorActionContext,
  type EditorActionHandlers,
} from "@/lib/editor-actions";
import { adaptToCommandPalette } from "@/lib/editor-actions-adapter";
import {
  findIssuesForField,
  validateScenario,
  type ValidationIssue,
} from "@/lib/validate-scenario";
import { BulkInspector } from "@/components/editor/bulk-inspector";
import { CustomParamsField } from "@/components/editor/custom-params-field";
import type { CustomParam } from "@/lib/custom-params";
import { FieldErrorIndicator } from "@/components/editor/field-error-indicator";
import { ValidationPanel } from "@/components/editor/validation-panel";
import {
  canRedo,
  canUndo,
  deserializeHistory,
  EMPTY_HISTORY,
  recordChange,
  redo as historyRedo,
  serializeHistory,
  snapshotKey,
  undo as historyUndo,
  type EditorHistory,
  type EditorSnapshot,
} from "@/lib/editor-history";
import {
  deleteScenario,
  listScenarios,
  loadScenario,
  markScenarioUsed,
  saveScenario,
  setScenarioNotes,
  type ScenarioSummary,
} from "@/lib/scenario-store";
import { buildBundle, importBundle, isBundle, stringifyBundle } from "@/lib/scenario-bundle";
import { cycleStats } from "@/lib/cycle-stats";
import { derivePlayback } from "@/lib/derive-playback";
import { useOnlineStatus } from "@/lib/online-status";
import { toast } from "@/lib/toast";
import { PlaybackController } from "@/components/editor/playback-controller";
import { CanvasControls } from "@/components/editor/canvas-controls";
import { NonStationInspector } from "@/components/editor/non-station-inspector";
import { RunConsole, logToRunConsole } from "@/components/editor/run-console";
import { ScenariosList } from "@/components/editor/scenarios-list";
import { Coach } from "@/components/editor/coach";
import { buildCoachTips } from "@/lib/coach-tips";
import {
  DEFAULT_RUN_SETTINGS,
  loadRunSettings,
  type RunSettings,
  saveRunSettings,
} from "./editor-run-settings";
// VROL-810 — leaf extractions out of this 7000-line god component:
// graph persistence + Inspector field editors now live under src/editor/.
import {
  ensureStationKeys,
  generateStationKey,
  INITIAL_EDGES,
  INITIAL_NODES,
  loadGraph,
  saveGraph,
} from "@/editor/state/persistence";
import {
  BreaksEditor,
  MaintenanceWindowsEditor,
  PerProductCyclesEditor,
  SetupTimeEditor,
  SkillsField,
} from "@/editor/inspector-fields";

/**
 * VROL-773 — three-up Inspector tabs. Storage key is sessionStorage so the
 * choice persists across station selections within a tab but resets when
 * the browser tab closes.
 */
type InspectorTab = "basics" | "schedule" | "recipe-cost";
const INSPECTOR_TAB_STORAGE_KEY = "vrolen:inspector-tab";
const INSPECTOR_TAB_ORDER: readonly InspectorTab[] = ["basics", "schedule", "recipe-cost"];
const INSPECTOR_TAB_LABEL: Record<InspectorTab, string> = {
  basics: "Basics",
  schedule: "Schedule",
  "recipe-cost": "Recipe & cost",
};
/**
 * Per-tab field-key allowlist for error-dot aggregation. A validation issue
 * whose `path` ends with `.${fieldKey}` (and whose `nodeId` matches the
 * selected node) contributes to that tab's dot.
 */
const INSPECTOR_TAB_FIELDS: Record<InspectorTab, readonly string[]> = {
  basics: ["label", "cycleDistribution", "cycleMs", "defectRate", "capacity"],
  schedule: [
    "maintenanceWindows",
    "skills",
    "reworkTargetNodeId",
    "reworkPassLimit",
    "customParams",
  ],
  "recipe-cost": [
    "cycleByProduct",
    "costPerHour",
    "costPerCycle",
    "costPerScrap",
    "revenuePerPart",
  ],
};

interface PaletteItem {
  readonly stationType: string;
  readonly label: string;
  readonly icon: typeof Factory;
  readonly summary: string;
  /**
   * VROL-784 — single-letter shortcut that inserts this station at the
   * canvas-cursor position. Lowercased, matched against `event.key` after
   * the modifier / focus-target filters in EditorCanvas's keydown handler.
   */
  readonly key: string;
  /** Display label for the shortcut chip + tooltip (e.g. "M", "Shift+M"). */
  readonly keyHint: string;
}

const STATION_TYPE_ICON: Record<string, typeof Factory> = {
  machine: Factory,
  manual: CircleDot,
  buffer: Boxes,
  qc: PackageCheck,
  assembly: Combine,
  transport: Truck,
  input: ConciergeBell,
  output: Wrench,
  // VROL-274 — escape-hatch type for stations that don't fit the standard
  // typed renderers. Engine treats as a normal timed-delay station.
  custom: HelpCircle,
};

const PALETTE: readonly PaletteItem[] = [
  // VROL-784 — single-letter shortcuts. `m` -> machine, `n` -> manual (m
  // taken), then mostly first-letter matches. See KeyboardShortcutsOverlay
  // and the keydown handler in EditorCanvas for the dispatch.
  // prettier-ignore
  { stationType: "machine", label: "Machine", icon: Factory, summary: "Stochastic cycle time", key: "m", keyHint: "M" },
  // prettier-ignore
  { stationType: "manual", label: "Manual", icon: CircleDot, summary: "Worker-driven", key: "n", keyHint: "N" },
  // prettier-ignore
  { stationType: "buffer", label: "Buffer", icon: Boxes, summary: "FIFO storage", key: "b", keyHint: "B" },
  // prettier-ignore
  { stationType: "qc", label: "QC", icon: PackageCheck, summary: "Defect inspection", key: "q", keyHint: "Q" },
  // prettier-ignore
  { stationType: "assembly", label: "Assembly", icon: Combine, summary: "Many in, one out", key: "a", keyHint: "A" },
  // prettier-ignore
  { stationType: "transport", label: "Transport", icon: Truck, summary: "Move parts", key: "t", keyHint: "T" },
  // prettier-ignore
  { stationType: "input", label: "Material input", icon: ConciergeBell, summary: "Source", key: "i", keyHint: "I" },
  // prettier-ignore
  { stationType: "output", label: "Output", icon: Wrench, summary: "Sink", key: "o", keyHint: "O" },
  // VROL-270 — packaging closes the 10-type palette set: end-of-line case
  // packers, palletisers, shrink-wrappers. Distinct accent from Machine so
  // it reads as the "ship it" affordance.
  {
    stationType: "packaging",
    label: "Packaging",
    icon: Package,
    summary: "End-of-line cartoning / palletising",
    key: "p",
    keyHint: "P",
  },
  // VROL-274 — generic escape-hatch.
  // prettier-ignore
  { stationType: "custom", label: "Custom", icon: HelpCircle, summary: "Generic timed-delay", key: "c", keyHint: "C" },
];

interface RunMeta {
  chainNodeIds: string[];
  stationLabels: string[];
  stationKeys: string[];
  /** "sourceNodeId arrow targetNodeId" keys, in the order the engine returned them. */
  edgeKeys: string[];
}

interface StationNodeData {
  label?: string;
  stationType?: string;
  maintenanceWindows?: { startMs: number; endMs: number }[];
  skills?: string[];
  setupDistribution?: Distribution;
  cycleDistribution?: Distribution;
  changeoverMatrix?: Record<string, Record<string, Distribution>>;
  /** Cumulative-completed series injected by EditorPage when samples exist (VROL-614). */
  sparklineSeries?: number[];
  /** Per-station time-weighted state mix injected by EditorPage after a run (VROL-893). */
  stateMix?: ReadonlyArray<{ readonly state: string; readonly pct: number }>;
  /** Defects from THIS station get routed to this node id instead of scrapping (VROL-627). */
  reworkTargetNodeId?: string;
  [key: string]: unknown;
}

/** VROL-776 — render a compact cycle-time mean: "~2.0 s" for >=1000 ms, else "~120 ms". */
function formatCycleMean(ms: number): string {
  if (ms >= 1000) {
    return `~${(ms / 1000).toFixed(1)} s`;
  }
  return `~${Math.round(ms).toString()} ms`;
}

/** VROL-776 — station types where cycle-time has no meaning. */
const CYCLE_TIME_HIDDEN_TYPES = new Set(["buffer", "input", "output"]);

// VROL-631 — per-station-type accent: a Tailwind class pair for the icon
// pill background and a subtle left border. Keeps types visually distinct
// without recoloring the card body so badges + sparklines stay readable.
const STATION_TYPE_ACCENT: Record<string, { pill: string; border: string }> = {
  machine: { pill: "bg-sim-running/15 text-sim-running", border: "border-l-sim-running/60" },
  qc: { pill: "bg-sim-setup/15 text-sim-setup", border: "border-l-sim-setup/60" },
  transport: {
    pill: "bg-sim-blocked/15 text-sim-blocked",
    border: "border-l-sim-blocked/60",
  },
  input: { pill: "bg-sim-idle/25 text-foreground", border: "border-l-sim-idle/80" },
  output: {
    pill: "bg-sim-maintenance/15 text-sim-maintenance",
    border: "border-l-sim-maintenance/60",
  },
  // VROL-270 — packaging accent uses the maintenance hue at higher saturation
  // so it reads distinct from output and machine.
  packaging: {
    pill: "bg-sim-down/15 text-sim-down-foreground",
    border: "border-l-sim-down/60",
  },
  // VROL-274 — neutral muted accent so a CustomStation reads as "tell me
  // what this is" rather than borrowing semantics from one of the typed types.
  custom: { pill: "bg-muted text-muted-foreground", border: "border-l-muted-foreground/40" },
};

function StationNode({ data, selected, id }: NodeProps) {
  const d = data as StationNodeData;
  const Icon = STATION_TYPE_ICON[d.stationType ?? "machine"] ?? Factory;
  const accent = STATION_TYPE_ACCENT[d.stationType ?? "machine"] ?? STATION_TYPE_ACCENT.machine!;
  // Inline edit state — Excalidraw-style double-click rename. Commits on
  // Enter or blur; Esc cancels and restores the prior label.
  const stationFlow = useReactFlow();
  const [editing, setEditing] = useState<boolean>(false);
  const [draft, setDraft] = useState<string>("");
  const maintenanceCount = Array.isArray(d.maintenanceWindows) ? d.maintenanceWindows.length : 0;
  const skillCount = Array.isArray(d.skills) ? d.skills.length : 0;
  const hasSetup = !!d.setupDistribution;
  const hasMatrix =
    d.changeoverMatrix && typeof d.changeoverMatrix === "object"
      ? Object.keys(d.changeoverMatrix).length > 0
      : false;
  const hasRework = typeof d.reworkTargetNodeId === "string" && d.reworkTargetNodeId.length > 0;
  // VROL-776 — compact cycle-time readout on the node face. Hidden for
  // buffer / input / output (no meaningful cycle time) and when the mean
  // resolves to 0 or the distribution isn't set.
  const stationType = d.stationType ?? "machine";
  const cycleMeanMs =
    !CYCLE_TIME_HIDDEN_TYPES.has(stationType) && isDistribution(d.cycleDistribution)
      ? meanOfDistribution(d.cycleDistribution)
      : 0;
  const showCycleMean = cycleMeanMs > 0;
  // VROL-274 — CustomStation explicit badge so the canvas surface always
  // tells the user "this is user-defined" without opening Inspector.
  const isCustom = d.stationType === "custom";
  // VROL-650 — surface parallel-capacity on the node so it's discoverable
  // without opening Inspector. capacity=1 (default) shows nothing.
  const capacity =
    typeof (d as { capacity?: unknown }).capacity === "number"
      ? ((d as { capacity: number }).capacity as number)
      : 1;
  const hasParallel = capacity > 1;
  // VROL-304 — validation severity dot. EditorPage injects this into node
  // data via nodesForFlow so the StationNode can render an indicator
  // without coupling to validation state directly.
  const validationSeverity = (d as { _validationSeverity?: "error" | "warning" })
    ._validationSeverity;
  // VROL-692 — bottleneck badge injected by EditorPage's nodesForFlow.
  const isBottleneck = (d as { _isBottleneck?: boolean })._isBottleneck === true;
  // VROL-901 — nominal/operating ratio. Present (< 0.95) only when the user
  // set nominalCycleTimeMs AND the station is operating below it.
  const nominalSpeedRatio = (d as { _nominalSpeedRatio?: number })._nominalSpeedRatio;
  const showThrottleChip = typeof nominalSpeedRatio === "number" && nominalSpeedRatio < 0.95;
  // Live playback — when EditorPage is playing back a finished run, it
  // injects the station's current dominant state. Drives the body tint
  // + the pulsing dot so the canvas reads like a live simulation.
  const playbackState = (d as { _playbackState?: string })._playbackState;
  const isLocked = (d as { _locked?: boolean })._locked === true;
  const playbackTint =
    playbackState === "Running"
      ? "bg-sim-running/10 ring-sim-running/40"
      : playbackState === "Starved"
        ? "bg-sim-starved/15 ring-sim-starved/40"
        : playbackState === "BlockedOut"
          ? "bg-sim-blocked/15 ring-sim-blocked/40"
          : playbackState === "Down"
            ? "bg-sim-down/15 ring-sim-down/40"
            : playbackState === "Setup"
              ? "bg-sim-setup/15 ring-sim-setup/40"
              : playbackState === "Maintenance"
                ? "bg-sim-maintenance/15 ring-sim-maintenance/40"
                : playbackState
                  ? "bg-sim-idle/20 ring-sim-idle/40"
                  : "";
  const playbackDotColor =
    playbackState === "Running"
      ? "bg-sim-running"
      : playbackState === "Starved"
        ? "bg-sim-starved"
        : playbackState === "BlockedOut"
          ? "bg-sim-blocked"
          : playbackState === "Down"
            ? "bg-sim-down"
            : playbackState === "Setup"
              ? "bg-sim-setup"
              : playbackState === "Maintenance"
                ? "bg-sim-maintenance"
                : "bg-sim-idle";
  // VROL-802 — outer state ring tint. Sits OUTSIDE the node border so it
  // stays legible against a busy canvas (the existing playbackTint only
  // shades the body interior).
  const playbackRingBorder =
    playbackState === "Running"
      ? "border-sim-running"
      : playbackState === "Starved"
        ? "border-sim-starved"
        : playbackState === "BlockedOut"
          ? "border-sim-blocked"
          : playbackState === "Down"
            ? "border-sim-down"
            : playbackState === "Setup"
              ? "border-sim-setup"
              : playbackState === "Maintenance"
                ? "border-sim-maintenance"
                : playbackState
                  ? "border-sim-idle"
                  : "";
  // VROL-802 — pull the live canvas zoom so we can collapse the badge row
  // + cycle-time line below 0.6× (illegible past that point and just
  // smears the canvas). useStore reads s.transform[2], the zoom factor.
  const zoom = useStore((s: { transform: readonly [number, number, number] }) => s.transform[2]);
  const isLowZoom = zoom < 0.6;

  return (
    <div
      className={`bg-card relative min-w-[148px] rounded-lg border border-l-4 px-3 py-2 shadow-sm transition-shadow ${
        accent.border
      } ${
        selected
          ? "ring-foreground/40 border-foreground/30 shadow-md ring-2"
          : "border-border hover:shadow-md"
      } ${playbackTint ? `ring-2 ${playbackTint}` : ""}`}
    >
      {/* VROL-802 — outer 2px state ring. Sits OUTSIDE the node border so
          the playback state stays readable on a busy canvas. The inner
          playbackTint shades the body; this draws the outline. */}
      {playbackRingBorder ? (
        <span
          data-testid="station-state-ring"
          aria-hidden
          className={`pointer-events-none absolute -inset-[3px] rounded-[10px] border-2 ${playbackRingBorder}`}
        />
      ) : null}
      {playbackState ? (
        <span
          className={`absolute -top-1 right-1 z-10 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${playbackDotColor} text-white shadow-sm`}
          aria-label={`Currently ${playbackState}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full bg-white/90 ${playbackState === "Running" ? "animate-pulse" : ""}`}
            aria-hidden
          />
          {playbackState === "BlockedOut" ? "Blocked" : playbackState}
        </span>
      ) : null}
      {/* VROL-304 — validation severity indicator. Errors red, warnings yellow. */}
      {validationSeverity ? (
        <span
          className={`absolute -top-1.5 -right-1.5 h-3 w-3 rounded-full ring-2 ring-white ${
            validationSeverity === "error" ? "bg-sim-down" : "bg-sim-setup"
          }`}
          aria-label={validationSeverity === "error" ? "Validation error" : "Validation warning"}
        />
      ) : null}
      {/* VROL-692 — bottleneck pulse badge. */}
      {isBottleneck ? (
        <span
          className="bg-sim-blocked text-sim-blocked-foreground absolute -top-2 -left-2 z-10 animate-pulse rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase shadow-sm ring-2 ring-white"
          aria-label="Bottleneck station"
          title="This station capped the line in the last run."
        >
          Bottleneck
        </span>
      ) : null}
      {/* VROL-901 — subordination chip. A non-bottleneck station running
          below its OEM-rated nominal max is "subordinated" — deliberately
          paced to match the binding constraint. Muted, informational. */}
      {showThrottleChip && !isBottleneck ? (
        <span
          className="bg-muted text-muted-foreground absolute -top-2 right-2 z-10 rounded-full px-1.5 py-0.5 text-[9px] font-semibold shadow-sm ring-2 ring-white"
          aria-label={`Subordinated — running at ${String(Math.round(nominalSpeedRatio * 100))} percent of nominal`}
          title={`Subordinated to the bottleneck. Running at ${String(Math.round(nominalSpeedRatio * 100))}% of nominal — speeding it up alone wouldn't lift line throughput.`}
        >
          {Math.round(nominalSpeedRatio * 100)}% nom
        </span>
      ) : null}
      {/* Lock badge — set via right-click → Lock. The node's draggable
          flag is also flipped so React Flow refuses to move it.
          VROL-802 — emoji swapped for lucide Lock so the badge matches
          the rest of the iconography. */}
      {isLocked ? (
        <span
          className="bg-muted text-muted-foreground absolute -right-2 -bottom-2 z-10 inline-flex items-center justify-center rounded-full p-1 shadow-sm ring-2 ring-white"
          aria-label="Locked"
          title="Locked. Right-click → Unlock to move."
        >
          <LockIcon aria-hidden className="h-2.5 w-2.5" />
        </span>
      ) : null}
      {/* Four side handles — Miro-like. ConnectionMode.Loose lets each
          source handle also accept incoming connections, so the user can
          start a connection from any side of any node and drop it onto
          any side of any other node. The edge's underlying direction is
          still determined by (source, target) on the resulting edge. */}
      <Handle
        id="t"
        type="source"
        position={Position.Top}
        className="vrolen-handle vrolen-handle--top"
      />
      <Handle
        id="l"
        type="source"
        position={Position.Left}
        className="vrolen-handle vrolen-handle--left"
      />
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${accent.pill}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        {editing ? (
          <input
            ref={(el) => {
              if (el && document.activeElement !== el) {
                el.focus();
                el.select();
              }
            }}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
            }}
            onBlur={() => {
              const next = draft.trim() || "Station";
              stationFlow.setNodes((ns) =>
                ns.map((n) =>
                  n.id === id
                    ? { ...n, data: { ...(n.data as Record<string, unknown>), label: next } }
                    : n,
                ),
              );
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            className="bg-card/95 min-w-0 flex-1 rounded border px-1 text-[13px] font-semibold"
          />
        ) : (
          <div
            className="min-w-0 truncate text-[13px] font-semibold"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setDraft(typeof d.label === "string" ? d.label : "");
              setEditing(true);
            }}
          >
            {d.label ?? "Station"}
          </div>
        )}
      </div>
      {/* VROL-776 — cycle-time mean readout. Hidden when type is buffer /
          input / output or when no distribution is configured.
          VROL-802 — also hidden below 0.6× zoom (text becomes illegible). */}
      {showCycleMean && !isLowZoom ? (
        <div
          className="text-muted-foreground mt-0.5 pl-9 font-mono text-[10px] tabular-nums"
          title="Mean cycle time"
        >
          {formatCycleMean(cycleMeanMs)}
        </div>
      ) : null}
      {/* VROL-802 — emoji glyphs swapped for lucide icons so the badges
          match the rest of the editor iconography. Whole row collapses
          below 0.6× zoom — past that point the icons just smear. */}
      {!isLowZoom &&
      maintenanceCount +
        skillCount +
        (hasSetup ? 1 : 0) +
        (hasMatrix ? 1 : 0) +
        (hasRework ? 1 : 0) +
        (hasParallel ? 1 : 0) +
        (isCustom ? 1 : 0) >
        0 ? (
        <div
          data-testid="station-badges"
          className="text-muted-foreground mt-1.5 flex flex-wrap gap-1 text-[10px]"
        >
          {isCustom ? (
            <span
              className="bg-muted text-foreground rounded-full px-1.5 py-0.5"
              title="User-defined station — engine treats as a generic timed delay"
            >
              Custom
            </span>
          ) : null}
          {maintenanceCount > 0 ? (
            <span
              className="bg-muted inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
              title="Maintenance windows"
            >
              <Wrench aria-hidden className="h-2.5 w-2.5" />
              {maintenanceCount}
            </span>
          ) : null}
          {skillCount > 0 ? (
            <span
              className="bg-muted inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5"
              title="Required skills"
            >
              <Tag aria-hidden className="h-2.5 w-2.5" />
              {skillCount}
            </span>
          ) : null}
          {hasSetup ? (
            <span
              className="bg-muted inline-flex items-center rounded-full px-1.5 py-0.5"
              title="Setup time configured"
            >
              <RotateCcw aria-hidden className="h-2.5 w-2.5" />
            </span>
          ) : null}
          {hasMatrix ? (
            <span
              className="bg-muted inline-flex items-center rounded-full px-1.5 py-0.5"
              title="Changeover matrix"
            >
              <ArrowLeftRight aria-hidden className="h-2.5 w-2.5" />
            </span>
          ) : null}
          {hasRework ? (
            <span
              className="bg-muted inline-flex items-center rounded-full px-1.5 py-0.5"
              title="Rework target set"
            >
              <Repeat aria-hidden className="h-2.5 w-2.5" />
            </span>
          ) : null}
          {hasParallel ? <CapacityChip capacity={capacity} /> : null}
        </div>
      ) : null}
      {/* VROL-893 — per-station state-mix bar replaces the old cumulative-completed
          sparkline. In steady state every station ships at the bottleneck rate,
          so cumulative looked identical on every node and carried no per-station
          signal. State mix differs per station and tells the user where the line
          is breathing vs. choking.

          VROL-894 — clicking the bar opens a per-station drilldown Sheet so
          users can ask "what is THIS station doing?" without leaving the
          canvas. The Inspector keeps owning editing; this is the analytics
          entry point. */}
      {Array.isArray(d.stateMix) && d.stateMix.length > 0 ? (
        <button
          type="button"
          aria-label={`View report for ${typeof d.label === "string" ? d.label : "this station"}`}
          className="hover:ring-foreground/30 focus-visible:ring-foreground/40 group mt-1.5 block w-full rounded-sm text-left hover:ring-2 focus-visible:ring-2 focus-visible:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            window.dispatchEvent(
              new CustomEvent("vrolen:open-station-drilldown", {
                detail: { nodeId: id },
              }),
            );
          }}
          onPointerDown={(e) => {
            // Prevent xyflow from starting a node-drag when the user clicks the
            // report button. Without this, the click fires AND the node moves.
            e.stopPropagation();
          }}
        >
          <StateMixBar breakdown={d.stateMix} />
          <span className="text-muted-foreground group-hover:text-foreground mt-0.5 block text-[9px] tracking-wide uppercase">
            View report →
          </span>
        </button>
      ) : Array.isArray(d.sparklineSeries) && d.sparklineSeries.length > 1 ? (
        <div className="mt-1.5">
          <Sparkline series={d.sparklineSeries} />
        </div>
      ) : null}
      <Handle
        id="r"
        type="source"
        position={Position.Right}
        className="vrolen-handle vrolen-handle--right"
      />
      <Handle
        id="b"
        type="source"
        position={Position.Bottom}
        className="vrolen-handle vrolen-handle--bottom"
      />
    </div>
  );
}

import { AlignmentGuidesOverlay } from "@/components/canvas/alignment-guides";
import { useAlignmentGuides } from "@/components/canvas/use-alignment-guides";
import {
  CanvasContextMenu,
  type ContextMenuInsertItem,
  type ContextMenuTarget,
} from "@/components/canvas/context-menu";
import { InputAnalyzerModal } from "@/components/editor/input-analyzer-modal";
import { SaveNameDialog } from "@/components/editor/save-name-dialog";
import { CommandPalette, type CommandAction } from "@/components/canvas/command-palette";
import { AlignmentToolbar, type AlignOp } from "@/components/canvas/alignment-toolbar";
import {
  EdgeFloatingToolbar,
  type EdgeToolbarState,
} from "@/components/canvas/edge-floating-toolbar";
import type { EdgeArrowMode, EdgeLineShape } from "./AnimatedEdge";
// Sprint 85: QuickAddGhosts retired (ghost quick-add suggestion tiles removed).
import { applyAlignment } from "@/lib/align-nodes";
import { FrameNode } from "@/components/canvas/frame-node";
import { StickyNoteNode } from "@/components/canvas/sticky-note-node";
import { summarizeReplications, type ReplicationSummary } from "@/lib/replications";
import { summarizeCosts } from "@/lib/cost-economics";
import { runSensitivitySweep, type SensitivitySummary } from "@/lib/sensitivity-sweep";
import { runWipCurve, type WipCurveSummary } from "@/lib/wip-curve";
import {
  runOptimizationSearch,
  type OptimizationCandidate,
  type OptimizationSummary,
} from "@/lib/optimization-search";
import { isDistribution, meanOfDistribution, scaleDistribution } from "@/lib/scale-distribution";

const NODE_TYPES = { station: StationNode, sticky: StickyNoteNode, frame: FrameNode };

// Lazy-import AnimatedEdge so its react-flow getBezierPath dependency doesn't
// bloat the first non-editor route. It's used inside this lazy-loaded file,
// so a normal import is fine.
import { AnimatedEdge } from "./AnimatedEdge";
import { hasSeenWelcomeToast, markWelcomeToastSeen } from "@/lib/welcome-toast";

import { OnboardingTour } from "./OnboardingTour";
import { hasSeenOnboarding } from "./onboarding-state";
import { Sparkline } from "./Sparkline";
import { StateMixBar } from "@/components/canvas/state-mix-bar";
import { StationDrilldown } from "@/components/editor/station-drilldown";

// VROL-625 — lazy-load the result-panel cards + compare table + the charts
// they own. Editor first paint no longer includes them; the user pays for
// the chunk on first Run / opening the compare sheet. ThroughputChart +
// OeeOverTimeChart are NOT imported here directly anymore — they ride in
// ResultPanel's chunk via ResultPanel + ComparisonTable.
const ResultPanel = lazy(() => import("./ResultPanel").then((m) => ({ default: m.ResultPanel })));
const ComparisonTable = lazy(() =>
  import("./ResultPanel").then((m) => ({ default: m.ComparisonTable })),
);
const EDGE_TYPES = { animated: AnimatedEdge };

function EditorCanvas() {
  // VROL-630 — consume any pending preset BEFORE seeding useState so the
  // landing-page handoff arrives as the initial render, not after a flash
  // of the persisted graph. useState's lazy initializer is React's
  // sanctioned spot for one-shot side effects (vs useMemo, which the React
  // Compiler treats as a pure-value cache).
  const [initial] = useState(() => {
    // Wizard handoff wins over preset wins over persisted graph.
    const wizard = takePendingWizardCommit();
    if (wizard) {
      const baseSettings = loadRunSettings();
      const patch = wizard.settingsPatch;
      const settings: RunSettings = {
        ...baseSettings,
        horizonMs: patch.horizonMs,
        // VROL-871 — wizard now authors warmup, seed, replications too.
        warmupMs: typeof patch.warmupMs === "number" ? patch.warmupMs : baseSettings.warmupMs,
        seed: typeof patch.seed === "number" ? patch.seed : baseSettings.seed,
        replications:
          typeof patch.replications === "number"
            ? Math.max(1, Math.min(50, Math.floor(patch.replications)))
            : baseSettings.replications,
        interStationBufferCapacity: patch.interStationBufferCapacity,
        source: { ...baseSettings.source, ...patch.source },
        breakdowns: patch.breakdowns
          ? { ...baseSettings.breakdowns, ...patch.breakdowns }
          : baseSettings.breakdowns,
        samplerIntervalMs: patch.samplerIntervalMs,
        products: patch.products
          ? { ...baseSettings.products, ...patch.products }
          : baseSettings.products,
        workers: patch.workers
          ? { ...baseSettings.workers, ...patch.workers }
          : baseSettings.workers,
        materials: patch.materials
          ? { ...baseSettings.materials, ...patch.materials }
          : baseSettings.materials,
      };
      const nodesCopy = wizard.nodes.map((n) => ({ ...n, data: { ...n.data } }));
      const edgesCopy = wizard.edges.map((e) => ({ ...e }));
      return {
        nodes: ensureStationKeys(nodesCopy),
        edges: edgesCopy,
        settings,
        presetTitle: "New scenario" as string | undefined,
        autorun: wizard.autorun,
      };
    }
    const pending = consumePendingPreset();
    if (pending) {
      const { preset, autorun } = pending;
      const nodesCopy = preset.graph.nodes.map((n) => ({ ...n, data: { ...n.data } }));
      const edgesCopy = preset.graph.edges.map((e) => ({ ...e }));
      return {
        nodes: ensureStationKeys(nodesCopy),
        edges: edgesCopy,
        settings: { ...preset.settings },
        presetTitle: preset.title as string | undefined,
        // VROL-816 — demo CTA autorun: when the pending-preset handoff
        // carries autorun=true, fire the simulation as the editor mounts.
        autorun,
      };
    }
    const g = loadGraph();
    return {
      nodes: g.nodes,
      edges: g.edges,
      settings: loadRunSettings(),
      presetTitle: undefined as string | undefined,
      autorun: false,
    };
  });
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // VROL-663 — bulk-select state. Single click → length 1; shift-click or
  // box-select → length > 1; pane click → length 0.
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const onSelectionChange = useCallback(
    ({ nodes: sel, edges: edgeSel }: { nodes: Node[]; edges: Edge[] }) => {
      const ids = sel.map((n) => n.id);
      setSelectedNodeIds(ids);
      setSelectedNodeId(ids.length === 1 ? (ids[0] ?? null) : null);
      setSelectedEdgeId(edgeSel.length === 1 ? (edgeSel[0]?.id ?? null) : null);
    },
    [],
  );
  const bulkPatch = useCallback(
    (patch: Record<string, unknown>) => {
      const idSet = new Set(selectedNodeIds);
      setNodes((ns) =>
        ns.map((n) => {
          if (!idSet.has(n.id)) return n;
          const next: Record<string, unknown> = {
            ...(n.data as Record<string, unknown>),
            ...patch,
          };
          for (const k of Object.keys(patch)) {
            if (next[k] === undefined) delete next[k];
          }
          return { ...n, data: next };
        }),
      );
    },
    [selectedNodeIds, setNodes],
  );
  const [result, setResult] = useState<ChainResult | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  // VROL-894 — per-station analytics drilldown. Opened by clicking the
  // state-mix bar on any StationNode. Decoupled via a window CustomEvent so
  // the StationNode renderer doesn't need a callback threaded through xyflow
  // data (which would re-create the function on every keystroke).
  const [stationDrilldownNodeId, setStationDrilldownNodeId] = useState<string | null>(null);
  // Cross-replication summary — populated only when settings.replications > 1.
  const [replicationSummary, setReplicationSummary] = useState<ReplicationSummary | null>(null);
  // Baseline = the multi-replication results from the PRIOR run. Lets the
  // current run's ReplicationsCard show a paired-t CI vs the baseline.
  const [baselineSummary, setBaselineSummary] = useState<ReplicationSummary | null>(null);
  // Sensitivity sweep — fires on demand from the Results panel.
  const [sensitivitySummary, setSensitivitySummary] = useState<SensitivitySummary | null>(null);
  const [sensitivityRunning, setSensitivityRunning] = useState<boolean>(false);
  // Throughput-vs-WIP scan — fires on demand from the Results panel.
  const [wipCurveSummary, setWipCurveSummary] = useState<WipCurveSummary | null>(null);
  const [wipCurveRunning, setWipCurveRunning] = useState<boolean>(false);
  // Optimization grid search — fires on demand from the Results panel.
  const [optimizationSummary, setOptimizationSummary] = useState<OptimizationSummary | null>(null);
  const [optimizationRunning, setOptimizationRunning] = useState<boolean>(false);
  const [optimizationTargetKey, setOptimizationTargetKey] = useState<string | null>(null);
  // Bumped whenever an "apply" mutates nodes/settings and wants a re-run on
  // the NEXT render — using a useEffect avoids the setNodes-then-handleRun
  // race where handleRun's closure still has the old nodes.
  const [applyAndRunTick, setApplyAndRunTick] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [settings, setSettings] = useState<RunSettings>(() => initial.settings);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [scenariosOpen, setScenariosOpen] = useState<boolean>(false);
  // VROL-789 — search + recency segmentation moved into ScenariosList; sort
  // dropdown removed in favor of the 2-primary + collapsed-rest pattern.
  // VROL-726 — palette search input state.
  const [paletteSearch, setPaletteSearch] = useState<string>("");
  // VROL-682 — two slots for picking history runs to compare.
  const [historyCompareA, setHistoryCompareA] = useState<number | null>(null);
  const [historyCompareB, setHistoryCompareB] = useState<number | null>(null);
  // VROL-691 — name → notes draft buffer for the open inline editor.
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  // VROL-304 — validation panel popover state.
  const [validationOpen, setValidationOpen] = useState<boolean>(false);
  // VROL-309 — undo/redo. The commit is debounced 400ms so rapid changes
  // (typing in a field) collapse into a single history entry.
  // lastCommittedRef caches the last snapshot pushed to history; the
  // debounce checks this to skip no-ops + cooperate with undo/redo
  // applying snapshots back to live state.
  // VROL-659 — hydrate history from sessionStorage so a reload doesn't
  // lose past/future stacks. sessionStorage clears on tab close, which is
  // the right scope for "session" editor work.
  const [history, setHistory] = useState<EditorHistory>(() => {
    if (typeof window === "undefined") return EMPTY_HISTORY;
    try {
      return deserializeHistory(window.sessionStorage.getItem("vrolen.editor-history"));
    } catch {
      return EMPTY_HISTORY;
    }
  });
  const lastCommittedRef = useRef<EditorSnapshot>({ nodes, edges, settings });
  const lastCommittedKeyRef = useRef<string>(snapshotKey({ nodes, edges, settings }));
  const debouncedCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debouncedCommitRef.current !== null) clearTimeout(debouncedCommitRef.current);
    debouncedCommitRef.current = setTimeout(() => {
      debouncedCommitRef.current = null;
      const last = lastCommittedRef.current;
      if (last.nodes === nodes && last.edges === edges && last.settings === settings) return;
      // Sprint 86 — only record when the USER-meaningful state changes.
      // Selection toggles, react-flow's internal measurements, and the
      // simulator writing sparklines back into node.data all bump the
      // nodes reference without representing an action worth undoing.
      // snapshotKey() strips those fields so we dedupe silently.
      const nextKey = snapshotKey({ nodes, edges, settings });
      if (nextKey === lastCommittedKeyRef.current) {
        lastCommittedRef.current = { nodes, edges, settings };
        return;
      }
      setHistory((h) => recordChange(h, last));
      lastCommittedRef.current = { nodes, edges, settings };
      lastCommittedKeyRef.current = nextKey;
    }, 400);
  }, [nodes, edges, settings]);
  // VROL-659 — persist history to sessionStorage whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem("vrolen.editor-history", serializeHistory(history));
    } catch {
      // sessionStorage may be unavailable / full; in-memory still works.
    }
  }, [history]);
  const handleUndo = useCallback(() => {
    const current: EditorSnapshot = { nodes, edges, settings };
    const result = historyUndo(history, current);
    if (!result.applied) return;
    setHistory(result.history);
    setNodes([...result.applied.nodes]);
    setEdges([...result.applied.edges]);
    setSettings(result.applied.settings);
    lastCommittedRef.current = result.applied;
    lastCommittedKeyRef.current = snapshotKey(result.applied);
  }, [history, nodes, edges, settings, setNodes, setEdges]);
  const handleRedo = useCallback(() => {
    const current: EditorSnapshot = { nodes, edges, settings };
    const result = historyRedo(history, current);
    if (!result.applied) return;
    setHistory(result.history);
    setNodes([...result.applied.nodes]);
    setEdges([...result.applied.edges]);
    setSettings(result.applied.settings);
    lastCommittedRef.current = result.applied;
    lastCommittedKeyRef.current = snapshotKey(result.applied);
  }, [history, nodes, edges, settings, setNodes, setEdges]);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>(() => listScenarios());
  const [saveNameDraft, setSaveNameDraft] = useState<string>("");
  const [activeScenarioName, setActiveScenarioName] = useState<string | null>(null);
  /** Inline-confirm state for destructive scenario actions (VROL-605). */
  const [confirmAction, setConfirmAction] = useState<{
    scenario: string;
    kind: "load" | "load-run" | "delete";
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  /**
   * VROL-773 — Inspector active tab. Persisted per session under
   * `vrolen:inspector-tab` so flipping between stations keeps the same
   * focused view. Falls back to "basics" when the stored value is unknown.
   */
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>(() => {
    if (typeof window === "undefined") return "basics";
    try {
      const stored = window.sessionStorage.getItem(INSPECTOR_TAB_STORAGE_KEY);
      if (stored === "basics" || stored === "schedule" || stored === "recipe-cost") {
        return stored;
      }
    } catch {
      // sessionStorage may be unavailable; default to basics.
    }
    return "basics";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(INSPECTOR_TAB_STORAGE_KEY, inspectorTab);
    } catch {
      // sessionStorage may be unavailable / full; in-memory still works.
    }
  }, [inspectorTab]);
  /** VROL-635 — Drawer optional-sections expanded state (closed by default).
   *  VROL-AUDIT — schedule key removed when the accordion was deleted. */
  const [drawerSections, setDrawerSections] = useState<{
    materials: boolean;
    products: boolean;
    workers: boolean;
    breakdowns: boolean;
    source: boolean;
  }>({
    materials: false,
    products: false,
    workers: false,
    breakdowns: false,
    source: false,
  });
  const toggleDrawerSection = useCallback((key: keyof typeof drawerSections) => {
    setDrawerSections((s) => ({ ...s, [key]: !s[key] }));
  }, []);
  /**
   * VROL-632 — onboarding tour state. Auto-opens on first visit (gated by
   * the localStorage flag). Re-launchable via the toolbar '?' icon.
   * Skipped when the user arrived with a preset — the preset itself acts
   * as guided onboarding.
   */
  const [tourOpen, setTourOpen] = useState<boolean>(
    () => !initial.presetTitle && !hasSeenOnboarding(),
  );
  /** Inline-confirm state for per-history-entry Replay (VROL-611). */
  const [confirmReplay, setConfirmReplay] = useState<{ scenario: string; idx: number } | null>(
    null,
  );
  /**
   * When true, edges render as animated bezier paths with SVG dots flowing along
   * (VROL-606). Persisted via RunSettings.animateFlow so the toggle survives
   * reload (VROL-607).
   */
  const animateFlow = settings.animateFlow;
  const setAnimateFlow = useCallback(
    (next: boolean) => setSettings((prev) => ({ ...prev, animateFlow: next })),
    [setSettings],
  );
  /** Snapshot of the active scenario as JSON; used to detect drift for the modified badge. */
  const [activeScenarioSnapshot, setActiveScenarioSnapshot] = useState<string | null>(null);
  // VROL-812 — inline name dialog for first-save-from-Cmd+S on an Untitled
  // scenario. Replaces the prior native-prompt / silent-no-op behaviour.
  const [saveNameDialogOpen, setSaveNameDialogOpen] = useState<boolean>(false);
  // VROL-654 — rendered-form shape so both live runs + restored snapshots
  // hydrate the same state. ScenarioRunOutcome is normalized at call site.
  const [comparison, setComparison] = useState<{
    aName: string;
    aResult: ScenarioRunOutcome["result"];
    aStationLabels: readonly string[];
    bName: string;
    bResult: ScenarioRunOutcome["result"];
    bStationLabels: readonly string[];
    horizonMs: number;
    warmupMs: number;
  } | null>(null);
  // VROL-654 — persisted comparison history.
  const [savedComparisons, setSavedComparisons] = useState<readonly ComparisonEntry[]>(() =>
    listComparisons(),
  );
  const [historyByScenario, setHistoryByScenario] = useState<Record<string, RunHistoryEntry[]>>(
    () => {
      const out: Record<string, RunHistoryEntry[]> = {};
      for (const s of listScenarios()) {
        out[s.name] = [...listRunHistory(s.name)];
      }
      return out;
    },
  );
  // VROL-674 — flattened recent runs across all scenarios for the sticky panel.
  const recentRuns: readonly RunHistoryEntryWithScenario[] = useMemo(() => {
    const all: RunHistoryEntryWithScenario[] = [];
    for (const [name, entries] of Object.entries(historyByScenario)) {
      for (const e of entries) all.push({ ...e, scenarioName: name });
    }
    all.sort((a, b) => b.runAtMs - a.runAtMs);
    return all.slice(0, 10);
  }, [historyByScenario]);

  useEffect(() => {
    saveRunSettings(settings);
  }, [settings]);

  // VROL-677 — one-time welcome toast on first /editor visit. Fires alongside
  // the modal tour for users who skip the tour; harmless if both surface.
  useEffect(() => {
    if (hasSeenWelcomeToast()) return;
    markWelcomeToastSeen();
    const id = setTimeout(() => {
      toast.message("Welcome to the editor", {
        description:
          "Drag a station from the palette on the left, or open Scenarios → Examples to load a preset.",
      });
    }, 600);
    return () => {
      clearTimeout(id);
    };
  }, []);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Sprint 90 — track Space-to-pan so the wrapper gets a `data-pan-mode`
  // attribute and the CSS shows a grab cursor. React-flow does the actual
  // panning via panActivationKeyCode="Space"; we just mirror the state.
  const [spacePanning, setSpacePanning] = useState<boolean>(false);
  useEffect(() => {
    const isEditableTarget = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null;
      if (!t) return false;
      const tag = t.tagName;
      return (
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true
      );
    };
    const onDown = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      if (isEditableTarget(e.target)) return;
      setSpacePanning(true);
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.code !== "Space") return;
      setSpacePanning(false);
    };
    const onBlur = (): void => setSpacePanning(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  const flow = useReactFlow();
  // Subscribe to the live canvas viewport so the floating alignment
  // toolbar repositions on pan / zoom.
  const viewport = useViewport();
  // Alignment guides + Shift axis-lock fire on every ReactFlow node drag.
  const alignmentGuides = useAlignmentGuides();
  // VROL-432 — offline mode signal. Cloud-sync flows (none yet) and AI
  // assistance (when shipped) gate off this. Until then it drives a small
  // banner so the user knows what's degraded.
  const isOnline = useOnlineStatus();
  // Live simulation playback state. When a finished run has samples, the
  // PlaybackController owns this and the canvas paints stations + edges
  // accordingly. `null` = no playback active (canvas stays static).
  const [playbackMs, setPlaybackMs] = useState<number | null>(null);
  // Bumps every time a fresh run completes — passed to PlaybackController
  // so it runs a 3-2-1 countdown and auto-starts playback on each new run.
  const [runNonce, setRunNonce] = useState<number>(0);
  const playbackSnapshot = useMemo(() => {
    if (playbackMs === null || !result || result.samples.length < 2) return null;
    return derivePlayback(result, playbackMs);
  }, [playbackMs, result]);
  const nodeIdRef = useRef<number>(
    initial.nodes.reduce((max, n) => Math.max(max, parseInt(n.id.replace(/\D/g, ""), 10) || 0), 0) +
      1,
  );
  // In-memory clipboard for Cmd+C / Cmd+V across the active editor session.
  // `count` is mirrored to state so the context menu's "Paste" item can
  // disable itself without reading the ref during render.
  const clipboardRef = useRef<{ nodes: readonly Node[]; edges: readonly Edge[] } | null>(null);
  const [clipboardCount, setClipboardCount] = useState<number>(0);
  // Right-click context menu — { kind, nodeId, clientX, clientY }.
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  // Save the right-click client position so we can paste at the cursor.
  const lastRightClickRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // VROL-784 — last mouse position over the canvas wrapper, in screen
  // coords. Read by the palette-shortcut keydown handler so single-letter
  // inserts (`m`, `q`, `b`, …) land where the cursor was hovering. Null
  // when the cursor isn't over the canvas — handler falls back to centre.
  const lastCanvasCursorRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // Cmd+K command palette.
  const [commandOpen, setCommandOpen] = useState<boolean>(false);
  // Input Analyzer modal — paste data, fit a distribution.
  const [inputAnalyzerOpen, setInputAnalyzerOpen] = useState<boolean>(false);
  // Drag-from-handle to create connected node. onConnectStart caches the
  // source handle; onConnectEnd creates the target node + edge when the
  // drag ended on empty canvas (no valid target).
  const connectingHandleRef = useRef<{
    nodeId: string;
    handleType: "source" | "target" | null;
  } | null>(null);

  // Autosave indicator — we keep the chip but never flip to a 'saving'
  // state. localStorage writes complete in well under a frame, so the
  // 'Saving…' flash was perceived as nervous UI. See note on the
  // saveGraph effect below.
  // VROL-739 — on first mount, if the persisted canvas was non-empty (i.e. we
  // actually recovered prior work), surface a one-shot toast with an Undo
  // affordance so the user can confirm or revert the restore.
  const restoreCheckedRef = useRef(false);
  useEffect(() => {
    if (restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    if (initial.presetTitle) return;
    if (initial.nodes.length === 0) return;
    toast.message("Restored last session", {
      description: `${String(initial.nodes.length)} stations · ${String(initial.edges.length)} edges`,
      duration: 4000,
      action: {
        label: "Start fresh",
        onClick: () => {
          setNodes([]);
          setEdges([]);
          setSelectedNodeId(null);
          toast.success("Canvas cleared");
        },
      },
    });
  }, [
    initial.nodes.length,
    initial.edges.length,
    initial.presetTitle,
    initial.nodes,
    initial.edges,
  ]);
  useEffect(() => {
    saveGraph({ nodes, edges });
    // localStorage write is synchronous; there is no observable
    // 'saving' window to indicate. Audit flagged the prior flash as
    // nervous UI — see note above.
  }, [nodes, edges]);

  /**
   * VROL-608 — DOM element wrapping the currently-open inline confirm row.
   * Used by the outside-click + Escape effect below to dismiss the confirm
   * when the user clicks elsewhere or presses Escape.
   */
  const confirmTargetRef = useRef<HTMLElement | null>(null);
  const anyConfirmOpen = confirmAction !== null || confirmReset || confirmReplay !== null;
  useEffect(() => {
    if (!anyConfirmOpen) return;
    const clearAll = () => {
      setConfirmAction(null);
      setConfirmReset(false);
      setConfirmReplay(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (
        confirmTargetRef.current &&
        target instanceof Node &&
        confirmTargetRef.current.contains(target)
      ) {
        return;
      }
      clearAll();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearAll();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [anyConfirmOpen]);

  // VROL-894 — listen for the per-station drilldown event dispatched when a
  // user clicks a StationNode's state-mix bar. Live as a window listener so
  // the renderer doesn't need a callback threaded through xyflow's data field.
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ readonly nodeId?: unknown }>).detail;
      const nodeId = typeof detail?.nodeId === "string" ? detail.nodeId : null;
      if (nodeId) setStationDrilldownNodeId(nodeId);
    };
    window.addEventListener("vrolen:open-station-drilldown", onOpen);
    return () => {
      window.removeEventListener("vrolen:open-station-drilldown", onOpen);
    };
  }, []);

  const selectedNode = selectedNodeId ? (nodes.find((n) => n.id === selectedNodeId) ?? null) : null;

  const updateSelectedNodeData = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedNodeId) return;
      setNodes((nds) =>
        nds.map((n) =>
          n.id === selectedNodeId
            ? { ...n, data: { ...(n.data as Record<string, unknown>), ...patch } }
            : n,
        ),
      );
    },
    [selectedNodeId, setNodes],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [setEdges],
  );
  const onConnect = useCallback<OnConnect>(
    (connection) => {
      setEdges((eds) => addEdge(connection, eds));
    },
    [setEdges],
  );

  // Drag-from-handle to create connected node (tldraw / Lucidchart style).
  // onConnectStart captures the originating handle; onConnectEnd checks if
  // the drag ended on empty canvas — if so, drop a new station at the
  // cursor and wire the edge automatically.
  const onConnectStart = useCallback(
    (
      _event: React.MouseEvent | React.TouchEvent | MouseEvent | TouchEvent,
      params: { nodeId: string | null; handleType: "source" | "target" | null },
    ) => {
      if (!params.nodeId) {
        connectingHandleRef.current = null;
        return;
      }
      connectingHandleRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
      };
    },
    [],
  );
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const handle = connectingHandleRef.current;
      connectingHandleRef.current = null;
      if (!handle) return;
      // Was the drop on the canvas pane (i.e. not on another handle)?
      const target = event.target as HTMLElement | null;
      const droppedOnPane = !!target?.classList?.contains?.("react-flow__pane");
      if (!droppedOnPane) return;
      const ev = "clientX" in event ? event : event.changedTouches?.[0];
      if (!ev) return;
      const flowPos = flow.screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      // SNAP-TO-EXISTING — if the drop is close to an existing node (within a
      // generous radius), connect to THAT node instead of creating a new one.
      // Beats the old behaviour where releasing slightly off a target node
      // dropped a stray "Machine" between the source and the intended target.
      const SNAP_RADIUS_PX = 90;
      const nearbyNode = nodes
        .filter((n) => n.id !== handle.nodeId && n.type !== "sticky" && n.type !== "frame")
        .map((n) => {
          const w = n.width ?? n.measured?.width ?? 180;
          const h = n.height ?? n.measured?.height ?? 60;
          const cx = n.position.x + w / 2;
          const cy = n.position.y + h / 2;
          const dx = flowPos.x - cx;
          const dy = flowPos.y - cy;
          // distance to bbox edge (negative if inside)
          const halfW = w / 2;
          const halfH = h / 2;
          const insideX = Math.max(0, Math.abs(dx) - halfW);
          const insideY = Math.max(0, Math.abs(dy) - halfH);
          return { node: n, dist: Math.hypot(insideX, insideY) };
        })
        .sort((a, b) => a.dist - b.dist)[0];
      if (nearbyNode && nearbyNode.dist <= SNAP_RADIUS_PX) {
        // Connect to the nearby existing node — don't create a stray Machine.
        const isReverse = handle.handleType === "target";
        const edgeId = `e${String(Date.now())}-${handle.nodeId}-${nearbyNode.node.id}`;
        const newEdge: Edge = {
          id: edgeId,
          source: isReverse ? nearbyNode.node.id : handle.nodeId,
          target: isReverse ? handle.nodeId : nearbyNode.node.id,
        };
        // Don't add duplicate edges between the same pair in the same direction.
        setEdges((eds) =>
          eds.some((e) => e.source === newEdge.source && e.target === newEdge.target)
            ? eds
            : eds.concat(newEdge),
        );
        return;
      }
      const newId = `n${String(nodeIdRef.current++)}`;
      const newNode: Node = {
        id: newId,
        type: "station",
        position: { x: flowPos.x - 90, y: flowPos.y - 30 },
        data: {
          label: "Machine",
          stationType: "machine",
          cycleDistribution: constant(100),
          defectRate: 0,
          stationKey: generateStationKey(),
        },
      };
      const isReverse = handle.handleType === "target";
      const newEdge: Edge = {
        id: `e${String(Date.now())}-${handle.nodeId}-${newId}`,
        source: isReverse ? newId : handle.nodeId,
        target: isReverse ? handle.nodeId : newId,
      };
      setNodes((ns) => ns.concat(newNode));
      setEdges((eds) => eds.concat(newEdge));
      setSelectedNodeId(newId);
    },
    [flow, nodes, setNodes, setEdges],
  );

  // Multi-select alignment toolbar. Anchor = top-mid of the selection bbox
  // in screen coords. Recomputed each render from the current selection.
  const onAlignmentOp = useCallback(
    (op: AlignOp) => {
      const ids = nodes.filter((n) => n.selected).map((n) => n.id);
      if (ids.length === 0) return;
      setNodes((ns) => applyAlignment(ns, ids, op));
    },
    [nodes, setNodes],
  );

  // Edge reconnection — drag the end of a connection and drop on a
  // different port to re-target it. Drop on empty canvas deletes it.
  // A ref tracks whether the in-flight reconnect actually landed on a
  // valid target so the onReconnectEnd handler knows whether to delete.
  const reconnectSucceededRef = useRef<boolean>(true);
  const onReconnectStart = useCallback(() => {
    reconnectSucceededRef.current = false;
  }, []);
  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      reconnectSucceededRef.current = true;
      setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    },
    [setEdges],
  );
  const onReconnectEnd = useCallback(
    (_e: MouseEvent | TouchEvent, edge: Edge) => {
      if (!reconnectSucceededRef.current) {
        setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      }
      reconnectSucceededRef.current = true;
    },
    [setEdges],
  );

  // Right-click context menu hooks.
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    lastRightClickRef.current = { clientX: e.clientX, clientY: e.clientY };
    const isLocked = node.draggable === false;
    const data = node.data as { label?: unknown; stationType?: unknown } | undefined;
    const labelStr = typeof data?.label === "string" ? data.label : "";
    const typeStr = typeof data?.stationType === "string" ? data.stationType : "";
    setContextMenu({
      kind: "node",
      nodeId: node.id,
      isLocked,
      headerTitle: labelStr || node.id,
      headerSubtitle: typeStr ? `${typeStr} station` : undefined,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, []);
  const onPaneContextMenu = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      e.preventDefault();
      const ev = e as React.MouseEvent;
      lastRightClickRef.current = { clientX: ev.clientX, clientY: ev.clientY };
      const selectedCount = nodes.filter((n) => n.selected).length;
      setContextMenu({
        kind: "pane",
        headerTitle: `${String(nodes.length)} node${nodes.length === 1 ? "" : "s"}`,
        headerSubtitle: selectedCount > 0 ? `${String(selectedCount)} selected` : undefined,
        clientX: ev.clientX,
        clientY: ev.clientY,
      });
    },
    [nodes],
  );
  const onEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      lastRightClickRef.current = { clientX: e.clientX, clientY: e.clientY };
      const labelFor = (id: string): string => {
        const n = nodes.find((m) => m.id === id);
        const d = n?.data as { label?: unknown } | undefined;
        return typeof d?.label === "string" && d.label.length > 0 ? d.label : id;
      };
      setContextMenu({
        kind: "edge",
        edgeId: edge.id,
        headerTitle: `${labelFor(edge.source)} → ${labelFor(edge.target)}`,
        headerSubtitle: undefined,
        clientX: e.clientX,
        clientY: e.clientY,
      });
      // Also select the edge so the floating style toolbar shows up above
      // it — the user is clearly interested in this edge.
      setSelectedEdgeId(edge.id);
      setEdges((es) => es.map((ed) => ({ ...ed, selected: ed.id === edge.id })));
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
    },
    [nodes, setEdges],
  );

  // Shared auto-layout — same algorithm the toolbar button runs, broken
  // out so the pane context menu can call it too.
  const runAutoLayout = useCallback(() => {
    if (nodes.length === 0) {
      toast.info("Canvas is empty");
      return;
    }
    const depth = new Map<string, number>();
    const idToNode = new Map(nodes.map((n) => [n.id, n]));
    const order = nodes.map((n) => n.id);
    for (const id of order) {
      if (!depth.has(id)) depth.set(id, 0);
    }
    let changed = true;
    let iters = 0;
    while (changed && iters < 100) {
      changed = false;
      iters++;
      for (const e of edges) {
        const s = depth.get(e.source) ?? 0;
        const t = depth.get(e.target) ?? 0;
        if (t < s + 1) {
          depth.set(e.target, s + 1);
          changed = true;
        }
      }
    }
    const cols = new Map<number, string[]>();
    for (const id of order) {
      const d = depth.get(id) ?? 0;
      const arr = cols.get(d) ?? [];
      arr.push(id);
      cols.set(d, arr);
    }
    setNodes((ns) =>
      ns.map((n) => {
        const d = depth.get(n.id) ?? 0;
        const colIds = cols.get(d) ?? [];
        const rank = colIds.indexOf(n.id);
        if (!idToNode.get(n.id)) return n;
        return { ...n, position: { x: 40 + d * 220, y: 40 + rank * 120 } };
      }),
    );
    toast.success("Auto-layout applied");
  }, [nodes, edges, setNodes]);

  // Z-order helpers — bring to front / send to back operate on the
  // selection if there is one, otherwise on the contextMenu's nodeId.
  const targetIds = useCallback((): readonly string[] => {
    const sel = nodes.filter((n) => n.selected).map((n) => n.id);
    if (sel.length > 0) return sel;
    return contextMenu?.nodeId ? [contextMenu.nodeId] : [];
  }, [nodes, contextMenu]);
  const bringToFront = useCallback(() => {
    const ids = new Set(targetIds());
    if (ids.size === 0) return;
    const maxZ = nodes.reduce((m, n) => Math.max(m, n.zIndex ?? 0), 0);
    setNodes((ns) => ns.map((n, i) => (ids.has(n.id) ? { ...n, zIndex: maxZ + 1 + i } : n)));
  }, [nodes, setNodes, targetIds]);
  const sendToBack = useCallback(() => {
    const ids = new Set(targetIds());
    if (ids.size === 0) return;
    const minZ = nodes.reduce((m, n) => Math.min(m, n.zIndex ?? 0), 0);
    setNodes((ns) => ns.map((n, i) => (ids.has(n.id) ? { ...n, zIndex: minZ - 1 - i } : n)));
  }, [nodes, setNodes, targetIds]);
  const toggleLock = useCallback(() => {
    const ids = new Set(targetIds());
    if (ids.size === 0) return;
    setNodes((ns) =>
      ns.map((n) =>
        ids.has(n.id)
          ? {
              ...n,
              draggable: n.draggable === false ? true : false,
              data: {
                ...(n.data as Record<string, unknown>),
                _locked: !(n.draggable === false),
              },
            }
          : n,
      ),
    );
  }, [setNodes, targetIds]);
  const deleteSelection = useCallback(() => {
    const ids = new Set(targetIds());
    if (ids.size === 0) return;
    setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
    setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
    setSelectedNodeId(null);
  }, [setNodes, setEdges, targetIds]);
  const duplicateSelection = useCallback(() => {
    const ids = new Set(targetIds());
    const selected = nodes.filter((n) => ids.has(n.id));
    if (selected.length === 0) return;
    const newNodes: Node[] = selected.map((n) => ({
      ...n,
      id: `n${String(nodeIdRef.current++)}`,
      position: { x: n.position.x + 24, y: n.position.y + 24 },
      data: { ...(n.data as Record<string, unknown>) },
      selected: true,
    }));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
  }, [nodes, setNodes, targetIds]);
  const pasteAtCursor = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip || clip.nodes.length === 0) return;
    const cursorClient = lastRightClickRef.current;
    const cursorFlow = cursorClient
      ? flow.screenToFlowPosition({ x: cursorClient.clientX, y: cursorClient.clientY })
      : null;
    // Anchor paste at the first clipboard node's original position so the
    // offset to the cursor lines up nicely.
    const anchor = clip.nodes[0]?.position ?? { x: 0, y: 0 };
    const offsetX = cursorFlow ? cursorFlow.x - anchor.x : 24;
    const offsetY = cursorFlow ? cursorFlow.y - anchor.y : 24;
    const idMap = new Map<string, string>();
    for (const n of clip.nodes) idMap.set(n.id, `n${String(nodeIdRef.current++)}`);
    const newNodes: Node[] = clip.nodes.map((n) => ({
      ...n,
      id: idMap.get(n.id) ?? n.id,
      position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
      data: { ...(n.data as Record<string, unknown>) },
      selected: true,
    }));
    const newEdges: Edge[] = clip.edges.map((ed) => ({
      ...ed,
      id: `e${String(Date.now())}-${idMap.get(ed.source) ?? ed.source}-${idMap.get(ed.target) ?? ed.target}`,
      source: idMap.get(ed.source) ?? ed.source,
      target: idMap.get(ed.target) ?? ed.target,
    }));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
    if (newEdges.length > 0) setEdges((eds) => [...eds, ...newEdges]);
  }, [flow, setNodes, setEdges]);

  // VROL-775 — pane right-click Insert. Spawns the chosen node kind at
  // the right-click position (or the canvas centre as a fallback). Mirrors
  // the offsets used by onDrop and the keyboard-insert path so the spawned
  // node lands centred on the cursor.
  const insertAtClient = useCallback(
    (
      kind: "station" | "sticky" | "frame",
      clientX: number,
      clientY: number,
      item?: PaletteItem,
    ) => {
      const pos = flow.screenToFlowPosition({ x: clientX, y: clientY });
      const id = `n${String(nodeIdRef.current++)}`;
      if (kind === "sticky") {
        const newNode: Node = {
          id,
          type: "sticky",
          position: pos,
          data: { text: "", color: "yellow" },
        };
        setNodes((ns) => ns.concat(newNode));
        return;
      }
      if (kind === "frame") {
        const newNode: Node = {
          id,
          type: "frame",
          position: pos,
          zIndex: -1,
          selectable: true,
          data: { label: "Section", color: "blue", width: 320, height: 200 },
        };
        setNodes((ns) => ns.concat(newNode));
        return;
      }
      if (!item) return;
      const newNode: Node = {
        id,
        type: "station",
        // Centre the spawned station on the cursor like onDrop does.
        position: { x: pos.x - 90, y: pos.y - 30 },
        data: {
          label: item.label,
          stationType: item.stationType,
          cycleDistribution: constant(100),
          defectRate: 0,
          stationKey: generateStationKey(),
        },
      };
      setNodes((ns) => ns.concat(newNode));
      setSelectedNodeId(id);
    },
    [flow, setNodes],
  );

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      // screenToFlowPosition takes SCREEN coords (event.clientX/Y). The
      // old code subtracted the wrapper's bounds first, which made the
      // node land far from the cursor. Pass the raw client coords.
      const position = flow.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      // Sticky-note drop branch — palette emits a dedicated MIME so the
      // drop dispatches a sticky instead of a station.
      const sticky = event.dataTransfer.getData("application/vrolen-sticky");
      if (sticky) {
        const id = `n${String(nodeIdRef.current++)}`;
        const newNode: Node = {
          id,
          type: "sticky",
          position,
          data: { text: "", color: "yellow" },
        };
        setNodes((nds) => nds.concat(newNode));
        return;
      }

      // Section frame drop branch — spawns a labeled container behind
      // other nodes (zIndex: -1) so existing stations remain selectable.
      const frame = event.dataTransfer.getData("application/vrolen-frame");
      if (frame) {
        const id = `n${String(nodeIdRef.current++)}`;
        const newNode: Node = {
          id,
          type: "frame",
          position,
          zIndex: -1,
          selectable: true,
          data: { label: "Section", color: "blue", width: 320, height: 200 },
        };
        setNodes((nds) => nds.concat(newNode));
        return;
      }

      const stationType = event.dataTransfer.getData("application/vrolen-station");
      if (!stationType) return;
      const item = PALETTE.find((p) => p.stationType === stationType);
      if (!item) return;

      const id = `n${String(nodeIdRef.current++)}`;
      const newNode: Node = {
        id,
        type: "station",
        position,
        data: {
          label: item.label,
          stationType: item.stationType,
          cycleDistribution: constant(100),
          defectRate: 0,
          stationKey: generateStationKey(),
        },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [flow, setNodes],
  );

  const handleReset = useCallback((): void => {
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setSelectedNodeId(null);
    setResult(null);
    setRunMeta(null);
    setActiveScenarioName(null);
    nodeIdRef.current = INITIAL_NODES.length + 1;
    toast.info("Editor reset");
  }, [setNodes, setEdges]);

  // Spawn a fresh station at the canvas center for the command palette
  // 'Insert' actions. Wrapped in useCallback so the closure that touches
  // wrapperRef + nodeIdRef is statically known to the linter — those refs
  // are only read at invocation time, not during render.
  const insertStationFromCenter = useCallback(
    (item: PaletteItem) => {
      const center = wrapperRef.current?.getBoundingClientRect();
      const pos = center
        ? flow.screenToFlowPosition({
            x: center.left + center.width / 2,
            y: center.top + center.height / 2,
          })
        : { x: 200, y: 200 };
      const id = `n${String(nodeIdRef.current++)}`;
      setNodes((ns) =>
        ns.concat({
          id,
          type: "station",
          position: { x: pos.x - 90, y: pos.y - 30 },
          data: {
            label: item.label,
            stationType: item.stationType,
            cycleDistribution: constant(100),
            defectRate: 0,
            stationKey: generateStationKey(),
          },
        }),
      );
      setSelectedNodeId(id);
    },
    [flow, setNodes],
  );

  // Wizard handoff autorun — declared just below handleRun so the
  // useEffect can reference it after declaration. Ref + bare effect.
  const autorunFiredRef = useRef<boolean>(false);

  const handleRun = useCallback((): void => {
    // VROL-86 — scenario validation. Errors block; warnings surface as a
    // softer toast but don't block.
    const validation = validateScenario(nodes, edges, settings);
    if (validation.errors.length > 0) {
      const first = validation.errors[0]!;
      const msg = `Can't run · ${String(validation.errors.length)} issue${validation.errors.length === 1 ? "" : "s"}`;
      const desc = first.fix ? `${first.message}. ${first.fix}.` : first.message;
      toast.error(msg, { description: desc });
      logToRunConsole("error", msg, desc);
      return;
    }
    if (validation.warnings.length > 0) {
      const first = validation.warnings[0]!;
      const msg = `${String(validation.warnings.length)} validation warning${validation.warnings.length === 1 ? "" : "s"}`;
      toast.warning(msg, { description: first.message });
      logToRunConsole("warning", msg, first.message);
    }
    const translation = graphToChainOptions(nodes, edges);
    if (translation.error) {
      toast.error("Can't run", { description: translation.error });
      logToRunConsole("error", "Can't run", translation.error);
      return;
    }
    logToRunConsole(
      "info",
      "Run started",
      `${String(nodes.length)} nodes · ${String(edges.length)} edges`,
    );
    // Stash the chain-order + edges-used for labeling after the run completes.
    setRunMeta({
      chainNodeIds: [...translation.chainNodeIds],
      stationLabels: [...translation.stationLabels],
      stationKeys: [...translation.stationKeys],
      edgeKeys: translation.topology
        ? translation.topology.edges.map((e) => `${e.source}→${e.target}`)
        : translation.chainNodeIds
            .slice(0, -1)
            .map((id, i) => `${id}→${String(translation.chainNodeIds[i + 1])}`),
    });
    if (translation.skippedNodeIds.length > 0) {
      toast.warning(
        `Skipped ${String(translation.skippedNodeIds.length)} node${
          translation.skippedNodeIds.length === 1 ? "" : "s"
        }`,
        { description: "Disconnected or branching nodes aren't part of the linear chain." },
      );
    }

    // Materials apply to whichever node is selected in the inspector — find its
    // chain index and skip the materials block entirely if it isn't in the chain.
    let materialsCfg: ChainMaterialConfig | undefined;
    if (settings.materials.enabled) {
      const stationIndex = selectedNodeId ? translation.chainNodeIds.indexOf(selectedNodeId) : -1;
      if (stationIndex < 0) {
        toast.warning("Materials skipped", {
          description: "Select a node in the chain before enabling materials in the drawer.",
        });
      } else {
        materialsCfg = settingsToMaterialsCfg(settings.materials, stationIndex);
      }
    }

    const breakdownsCfg: ChainBreakdownConfig | undefined = settings.breakdowns.enabled
      ? {
          mtbfMs: {
            kind: "exponential",
            rate: 1 / Math.max(1, settings.breakdowns.mtbfMs),
          },
          mttrMs: constant(Math.max(1, settings.breakdowns.mttrMs)),
        }
      : undefined;

    // Build per-station required skills from node.data.skills in topology order.
    const perStationSkills: string[][] = translation.chainNodeIds.map((id) => {
      const node = nodes.find((n) => n.id === id);
      const raw = (node?.data as { skills?: unknown } | undefined)?.skills;
      if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
      return [];
    });
    // Build per-station maintenance windows from the translator output.
    const maintenanceMap = new Map<number, { startMs: number; endMs: number }[]>();
    translation.maintenanceWindows.forEach((windows, i) => {
      if (windows.length > 0) {
        maintenanceMap.set(i, [...windows]);
      }
    });
    const maintenanceCfg: ChainMaintenanceConfig | undefined =
      maintenanceMap.size > 0 ? { perStationWindows: maintenanceMap } : undefined;

    const productsCfg: ChainProductsConfig | undefined =
      settings.products.enabled && settings.products.list.length > 0
        ? {
            products: settings.products.list.map((p) => ({
              id: p.id || p.name || "default",
              weight: Math.max(0, p.weight),
            })),
            // VROL-664 — production plan when authored.
            ...(settings.products.productionPlan && settings.products.productionPlan.length > 0
              ? { productionPlan: settings.products.productionPlan }
              : {}),
          }
        : undefined;

    const workersCfg: ChainWorkerConfig | undefined =
      settings.workers.enabled && settings.workers.list.length > 0
        ? {
            workers: settings.workers.list.map((entry, i) => ({
              id: asResourceId(`w${String(i + 1)}`),
              name: entry.name || `Worker ${String(i + 1)}`,
              skills: entry.skills.length > 0 ? entry.skills : ["any"],
              shifts: [{ startMs: 0, endMs: Math.max(1, entry.shiftEndMs) }],
              // VROL-616 — pass any per-worker breaks through to the engine.
              ...(entry.breaks && entry.breaks.length > 0 ? { breaks: entry.breaks } : {}),
            })),
            perStationSkills,
            // Default = empty → any worker on shift can take an unannotated station
            requireDefault: [],
          }
        : undefined;

    setIsRunning(true);
    setResult(null);
    setReplicationSummary(null);
    const replications = Math.max(1, Math.min(50, Math.floor(settings.replications)));
    setTimeout(() => {
      try {
        const t0 = performance.now();
        // Build the common opts once so each replication only varies its seed.
        const buildOpts = (seed: number) =>
          ({
            ...(translation.topology
              ? { topology: translation.topology }
              : {
                  stationCycleTimes: [...translation.cycleDistributions],
                  stationLabels: [...translation.stationLabels],
                }),
            interStationBufferCapacity: settings.interStationBufferCapacity,
            horizonMs: settings.horizonMs,
            warmupMs: Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2)),
            prng: new SeededPrng(seed),
            ...(materialsCfg ? { materials: materialsCfg } : {}),
            ...(breakdownsCfg ? { breakdowns: breakdownsCfg } : {}),
            ...(workersCfg ? { workers: workersCfg } : {}),
            ...(maintenanceCfg ? { maintenance: maintenanceCfg } : {}),
            ...(productsCfg ? { products: productsCfg } : {}),
            ...(settings.samplerIntervalMs > 0
              ? { sampler: { intervalMs: settings.samplerIntervalMs } }
              : {}),
            ...(settings.source.enabled
              ? {
                  source: {
                    interArrivalMs: constant(settings.source.intervalMs),
                    ...(settings.source.batchSize > 1
                      ? { batchSize: settings.source.batchSize }
                      : {}),
                  },
                }
              : {}),
          }) as const;
        // First rep is the canonical one (powers canvas + playback). Extra reps
        // contribute to the cross-replication 95 % CI summary only.
        const r = runChain(buildOpts(settings.seed));
        const allResults: ChainResult[] = [r];
        for (let i = 1; i < replications; i++) {
          allResults.push(runChain(buildOpts(settings.seed + i * 17)));
        }
        const wallMs = performance.now() - t0;
        if (replications > 1) {
          const summary = summarizeReplications(allResults);
          setReplicationSummary((prev) => {
            // Promote the previous run's summary into the baseline slot so the
            // ReplicationsCard can show "vs baseline" paired-t CIs.
            if (prev && prev.n === summary.n) setBaselineSummary(prev);
            return summary;
          });
        }
        // VROL-694 — compute throughput delta vs the previous run for this scenario.
        const prevRuns = activeScenarioName ? listRunHistory(activeScenarioName) : [];
        const prevRun = prevRuns[0];
        const tPerHr = r.throughputLambda * 3_600_000;
        const prevPerHr = prevRun ? prevRun.throughputLambda * 3_600_000 : null;
        let desc = `${r.completed.toLocaleString()} parts · ${tPerHr.toFixed(0)}/h`;
        if (prevPerHr !== null && prevPerHr > 0) {
          const deltaPct = ((tPerHr - prevPerHr) / prevPerHr) * 100;
          const arrow = deltaPct > 0.5 ? "▲" : deltaPct < -0.5 ? "▼" : "=";
          desc += ` (${arrow} ${Math.abs(deltaPct).toFixed(0)}% vs last)`;
        }
        desc += ` · ${wallMs.toFixed(0)}ms`;
        if (replications > 1) {
          desc = `${String(replications)} replications · ${desc}`;
        }
        setResult(r);
        // Auto-arm the playback scrubber at t=0 so the canvas replays the run
        // from the very beginning (warmup window included). Earlier we started
        // at warmupMs which surprised users — the slider should read 00:00.
        setPlaybackMs(r.samples.length >= 2 ? 0 : null);
        // Bump runNonce so PlaybackController fires its 3-2-1 countdown +
        // auto-starts playback at the user's default speed (5x).
        if (r.samples.length >= 2) setRunNonce((n) => n + 1);
        toast.success("Simulation complete", { description: desc });
        logToRunConsole("success", "Simulation complete", desc);
        // If a scenario is active, push a compact summary to history.
        if (activeScenarioName) {
          // VROL-714 — capture the bottleneck label so the migration card can
          // track changes across recent runs.
          const headBn = [...r.bottlenecks].sort((a, b) => b.runningPct - a.runningPct)[0];
          const summary: RunHistoryEntry = {
            completed: r.completed,
            throughputLambda: r.throughputLambda,
            lineOee: r.lineOee,
            avgTimeInSystemW: r.avgTimeInSystemW,
            ...(headBn?.label !== undefined ? { bottleneckLabel: headBn.label } : {}),
            runAtMs: Date.now(),
            payload: { graph: { nodes, edges }, settings },
          };
          addRunToHistory(activeScenarioName, summary);
          setHistoryByScenario((prev) => ({
            ...prev,
            [activeScenarioName]: [summary, ...(prev[activeScenarioName] ?? [])].slice(0, 5),
          }));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error("Simulation failed", { description: message });
        logToRunConsole("error", "Simulation failed", message);
      } finally {
        setIsRunning(false);
      }
    }, 0);
  }, [nodes, edges, selectedNodeId, settings, activeScenarioName]);

  // Wizard handoff autorun — fires once after mount if the wizard
  // asked for an immediate run. handleRun is captured from above; the
  // ref guard prevents double-fire under React strict-mode.
  useEffect(() => {
    if (!initial.autorun) return;
    if (autorunFiredRef.current) return;
    autorunFiredRef.current = true;
    const id = setTimeout(() => {
      handleRun();
    }, 250);
    return () => {
      clearTimeout(id);
    };
    // handleRun intentionally omitted — fire-once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.autorun]);

  // Apply-and-run effect — fires handleRun on the render AFTER an apply
  // bumps the tick. By then setNodes/setSettings have committed, so
  // handleRun's closure sees the new nodes (avoids the stale-closure race).
  const applyAndRunTickSeenRef = useRef<number>(0);
  useEffect(() => {
    if (applyAndRunTick === 0) return;
    if (applyAndRunTickSeenRef.current === applyAndRunTick) return;
    applyAndRunTickSeenRef.current = applyAndRunTick;
    if (isRunning) return;
    // handleRun synchronously mutates state to start the simulation; that's
    // the intended effect of an Apply action and there's no observable
    // cascading-render issue here. The tick ref guards against double-fire.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    handleRun();
    // handleRun intentionally omitted to avoid retriggering when its
    // identity changes; the tick guard ensures we fire at most once per bump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyAndRunTick, isRunning]);

  // Sensitivity sweep — fires 2N engine runs perturbing each station's
  // cycle time ±20%. Defers to a setTimeout so the UI updates the
  // 'Sweeping…' label before the loop blocks the thread.
  const handleSensitivitySweep = useCallback((): void => {
    const translation = graphToChainOptions(nodes, edges);
    if (translation.error) {
      toast.error("Can't sweep", { description: translation.error });
      return;
    }
    if (translation.cycleDistributions.length === 0) {
      toast.warning("Nothing to sweep", { description: "Add at least one timed station." });
      return;
    }
    setSensitivityRunning(true);
    setTimeout(() => {
      try {
        const horizonMs = settings.horizonMs;
        const warmupMs = Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2));
        const buildBaseOptions = () =>
          ({
            ...(translation.topology
              ? { topology: translation.topology }
              : {
                  stationCycleTimes: [...translation.cycleDistributions],
                  stationLabels: [...translation.stationLabels],
                }),
            interStationBufferCapacity: settings.interStationBufferCapacity,
          }) as ChainOptions;
        const summary = runSensitivitySweep({
          horizonMs,
          warmupMs,
          seed: settings.seed,
          buildBaseOptions,
          stationCycleDistributions: translation.cycleDistributions,
          stationLabels: translation.stationLabels,
        });
        setSensitivitySummary(summary);
        toast.success(
          `Sensitivity sweep · ${String(summary.rows.length)} stations · ${summary.elapsedMs.toFixed(0)}ms`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error("Sweep failed", { description: message });
      } finally {
        setSensitivityRunning(false);
      }
    }, 0);
  }, [nodes, edges, settings]);

  // Throughput-vs-WIP scan — runs N replays varying the buffer cap.
  const handleWipCurveScan = useCallback((): void => {
    const translation = graphToChainOptions(nodes, edges);
    if (translation.error) {
      toast.error("Can't scan WIP", { description: translation.error });
      return;
    }
    setWipCurveRunning(true);
    setTimeout(() => {
      try {
        const horizonMs = settings.horizonMs;
        const warmupMs = Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2));
        const buildBaseOptions = () =>
          ({
            ...(translation.topology
              ? { topology: translation.topology }
              : {
                  stationCycleTimes: [...translation.cycleDistributions],
                  stationLabels: [...translation.stationLabels],
                }),
          }) as ChainOptions;
        const summary = runWipCurve({
          horizonMs,
          warmupMs,
          seed: settings.seed,
          currentCapacity: settings.interStationBufferCapacity,
          buildBaseOptions,
        });
        setWipCurveSummary(summary);
        toast.success(
          `WIP scan · ${String(summary.points.length)} levels · ${summary.elapsedMs.toFixed(0)}ms`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error("WIP scan failed", { description: message });
      } finally {
        setWipCurveRunning(false);
      }
    }, 0);
  }, [nodes, edges, settings]);

  // Optimization grid search — 2-D sweep over (buffer cap × cycle multiplier
  // on the bottleneck station). 5 caps × 3 multipliers × 3 reps = 45 runs.
  const handleOptimizationSearch = useCallback((): void => {
    const translation = graphToChainOptions(nodes, edges);
    if (translation.error) {
      toast.error("Can't search", { description: translation.error });
      return;
    }
    if (translation.cycleDistributions.length === 0) {
      toast.error("Can't search", { description: "No stations in chain" });
      return;
    }
    let targetIdx = 0;
    let maxMean = -Infinity;
    translation.cycleDistributions.forEach((d, i) => {
      const m = meanOfDistribution(d);
      if (m > maxMean) {
        maxMean = m;
        targetIdx = i;
      }
    });
    const targetLabel = translation.stationLabels[targetIdx] ?? `Station ${String(targetIdx + 1)}`;
    const targetStationKey = translation.stationKeys[targetIdx];
    setOptimizationRunning(true);
    setTimeout(() => {
      try {
        const horizonMs = settings.horizonMs;
        const warmupMs = Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2));
        const buildBaseOptions = (cycleMultiplier: number): ChainOptions => {
          if (translation.topology) {
            const scaledTopology = {
              ...translation.topology,
              nodes: translation.topology.nodes.map((n, i) =>
                i === targetIdx
                  ? { ...n, cycleTimeMs: scaleDistribution(n.cycleTimeMs, cycleMultiplier) }
                  : n,
              ),
            };
            return { topology: scaledTopology } as ChainOptions;
          }
          return {
            stationCycleTimes: translation.cycleDistributions.map((d, i) =>
              i === targetIdx ? scaleDistribution(d, cycleMultiplier) : d,
            ),
            stationLabels: [...translation.stationLabels],
          } as ChainOptions;
        };
        const summary = runOptimizationSearch({
          horizonMs,
          warmupMs,
          seed: settings.seed,
          currentCapacity: settings.interStationBufferCapacity,
          targetStationIdx: targetIdx,
          targetStationLabel: targetLabel,
          buildBaseOptions,
        });
        setOptimizationSummary(summary);
        setOptimizationTargetKey(targetStationKey ?? null);
        toast.success(
          `Optimization · ${String(summary.searchSize)} runs · best WIP ${String(summary.best.bufferCapacity)} · ${targetLabel} @${summary.best.cycleMultiplier.toFixed(2)}×`,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error("Search failed", { description: message });
      } finally {
        setOptimizationRunning(false);
      }
    }, 0);
  }, [nodes, edges, settings]);

  // Apply both the best buffer capacity AND scale the target station's cycle
  // distribution by the best multiplier. Stations are identified by stationKey
  // (stable across renumbering), so the apply still works after edits.
  const handleApplyOptimization = useCallback(
    (candidate: OptimizationCandidate): void => {
      const stationKey = optimizationTargetKey;
      if (candidate.cycleMultiplier !== 1 && stationKey) {
        setNodes((ns) =>
          ns.map((n) => {
            const data = n.data as
              | { stationKey?: unknown; cycleDistribution?: unknown }
              | undefined;
            if (!data || data.stationKey !== stationKey) return n;
            if (!isDistribution(data.cycleDistribution)) return n;
            const scaled = scaleDistribution(data.cycleDistribution, candidate.cycleMultiplier);
            return {
              ...n,
              data: { ...(n.data as Record<string, unknown>), cycleDistribution: scaled },
            };
          }),
        );
      }
      setSettings((s) => ({ ...s, interStationBufferCapacity: candidate.bufferCapacity }));
      setApplyAndRunTick((x) => x + 1);
    },
    [optimizationTargetKey, setNodes],
  );

  const handleCompare = useCallback(
    (savedName: string): void => {
      const payload = loadScenario(savedName);
      if (!payload) {
        toast.error("Couldn't load scenario for comparison");
        return;
      }
      const aOutcome = runScenario(
        payload.graph.nodes,
        payload.graph.edges,
        payload.settings,
        null,
      );
      if (!("result" in aOutcome)) {
        toast.error(`Couldn't run "${savedName}"`, {
          description:
            aOutcome.kind === "materials-no-selection"
              ? "Materials are enabled but the saved scenario had no station selected."
              : aOutcome.kind === "translation"
                ? aOutcome.message
                : aOutcome.message,
        });
        return;
      }
      const bOutcome = runScenario(nodes, edges, settings, selectedNodeId);
      if (!("result" in bOutcome)) {
        toast.error("Couldn't run the current canvas", {
          description:
            bOutcome.kind === "materials-no-selection"
              ? "Select a station to attach materials to first."
              : bOutcome.kind === "translation"
                ? bOutcome.message
                : bOutcome.message,
        });
        return;
      }
      const horizonMs = settings.horizonMs;
      const warmupMs = Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2));
      // VROL-713 — honor the user's persisted A↔B flip preference.
      const flip =
        typeof window !== "undefined" &&
        window.localStorage?.getItem?.("vrolen.compare-flip") === "1";
      setComparison(
        flip
          ? {
              aName: "Current canvas",
              aResult: bOutcome.result,
              aStationLabels: bOutcome.runMeta.stationLabels,
              bName: savedName,
              bResult: aOutcome.result,
              bStationLabels: aOutcome.runMeta.stationLabels,
              horizonMs,
              warmupMs,
            }
          : {
              aName: savedName,
              aResult: aOutcome.result,
              aStationLabels: aOutcome.runMeta.stationLabels,
              bName: "Current canvas",
              bResult: bOutcome.result,
              bStationLabels: bOutcome.runMeta.stationLabels,
              horizonMs,
              warmupMs,
            },
      );
      // VROL-654 — persist the comparison so it survives navigating away.
      try {
        addComparison({
          id: `cmp-${String(Date.now())}-${String(Math.floor(Math.random() * 100000))}`,
          savedAtMs: Date.now(),
          aName: savedName,
          aResult: aOutcome.result,
          aStationLabels: aOutcome.runMeta.stationLabels,
          bName: "Current canvas",
          bResult: bOutcome.result,
          bStationLabels: bOutcome.runMeta.stationLabels,
          horizonMs,
          warmupMs,
        });
        setSavedComparisons(listComparisons());
      } catch {
        // best-effort — UI flow continues regardless
      }
      toast.success(`Comparing "${savedName}" vs current canvas`);
    },
    [nodes, edges, settings, selectedNodeId],
  );

  // VROL-309 — keyboard shortcuts. Cmd/Ctrl+Z = undo, +Shift = redo.
  // VROL-727 — Cmd/Ctrl+D = duplicate the currently selected station.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey;
      // VROL-731 / VROL-732 — non-modifier hotkeys (Delete/Backspace, Escape)
      // are dispatched here regardless of mod-state. Only swallow if not in an
      // input/textarea.
      if (!mod) {
        const t0 = e.target as HTMLElement | null;
        if (
          t0 &&
          (t0.tagName === "INPUT" ||
            t0.tagName === "TEXTAREA" ||
            t0.tagName === "SELECT" ||
            t0.isContentEditable)
        ) {
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          if (selectedNodeId) {
            e.preventDefault();
            const id = selectedNodeId;
            setNodes((ns) => ns.filter((n) => n.id !== id));
            setEdges((es) => es.filter((ed) => ed.source !== id && ed.target !== id));
            setSelectedNodeId(null);
          }
        } else if (
          // VROL-752 — arrow up/down cycles primary among the multi-selection.
          (e.key === "ArrowDown" || e.key === "ArrowUp") &&
          selectedNodeIds.length > 1 &&
          selectedNodeId
        ) {
          e.preventDefault();
          const idx = selectedNodeIds.indexOf(selectedNodeId);
          if (idx === -1) return;
          const next =
            e.key === "ArrowDown"
              ? (idx + 1) % selectedNodeIds.length
              : (idx - 1 + selectedNodeIds.length) % selectedNodeIds.length;
          const nextId = selectedNodeIds[next];
          if (nextId) setSelectedNodeId(nextId);
        } else if (e.key === "Escape") {
          // Close open sheets.
          if (scenariosOpen) {
            setScenariosOpen(false);
          } else if (settingsOpen) {
            setSettingsOpen(false);
          } else if (comparison !== null) {
            setComparison(null);
          }
        }
        return;
      }
      // Skip if the user is typing in an input / textarea / contenteditable.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key === "k") {
        // Cmd/Ctrl+K — open the command palette.
        e.preventDefault();
        setCommandOpen(true);
      } else if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if (key === "d" && selectedNodeId) {
        e.preventDefault();
        const original = nodes.find((n) => n.id === selectedNodeId);
        if (!original) return;
        const newId = `n${String(nodeIdRef.current++)}`;
        const copy: Node = {
          ...original,
          id: newId,
          position: { x: original.position.x + 60, y: original.position.y + 60 },
          selected: false,
          data: { ...(original.data as Record<string, unknown>) },
        };
        setNodes((ns) => [...ns, copy]);
        setSelectedNodeId(newId);
        toast.success(`Duplicated ${(original.data as { label?: string }).label ?? "station"}`);
      } else if (key === "enter") {
        // VROL-730 — Cmd/Ctrl+Enter triggers Run.
        e.preventDefault();
        if (!isRunning) handleRun();
      } else if (key === "s") {
        // VROL-733 + VROL-812 — Cmd/Ctrl+S saves the active scenario in
        // place. When the scenario is still Untitled, open the inline name
        // dialog rather than the prior silent no-op / native prompt.
        e.preventDefault();
        if (!activeScenarioName) {
          setSaveNameDialogOpen(true);
          return;
        }
        try {
          saveScenario(activeScenarioName, {
            graph: { nodes: [...nodes], edges: [...edges] },
            settings,
            savedAtMs: Date.now(),
          });
          setScenarios(listScenarios());
          setActiveScenarioSnapshot(JSON.stringify({ graph: { nodes, edges }, settings }));
          toast.success("Saved");
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err);
          toast.error("Save failed", { description: m });
        }
      } else if (key === "a") {
        // Cmd/Ctrl+A — select all nodes on the canvas.
        e.preventDefault();
        setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
      } else if (key === "c") {
        // Cmd/Ctrl+C — copy the current selection to the in-memory clipboard.
        const selected = nodes.filter((n) => n.selected || n.id === selectedNodeId);
        if (selected.length === 0) return;
        e.preventDefault();
        const ids = new Set(selected.map((n) => n.id));
        const selectedEdges = edges.filter((ed) => ids.has(ed.source) && ids.has(ed.target));
        clipboardRef.current = {
          nodes: selected.map((n) => ({
            ...n,
            position: { ...n.position },
            data: { ...(n.data as Record<string, unknown>) },
            selected: false,
          })),
          edges: selectedEdges,
        };
        setClipboardCount(selected.length);
        toast.success(`Copied ${String(selected.length)} node${selected.length === 1 ? "" : "s"}`);
      } else if (key === "v") {
        // Cmd/Ctrl+V — paste from clipboard with a +24/+24 offset and
        // re-map ids so the pastes don't collide.
        const clip = clipboardRef.current;
        if (!clip || clip.nodes.length === 0) return;
        e.preventDefault();
        const idMap = new Map<string, string>();
        for (const n of clip.nodes) {
          idMap.set(n.id, `n${String(nodeIdRef.current++)}`);
        }
        const offsetX = 24;
        const offsetY = 24;
        const newNodes: Node[] = clip.nodes.map((n) => ({
          ...n,
          id: idMap.get(n.id) ?? n.id,
          position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
          data: { ...(n.data as Record<string, unknown>) },
          selected: true,
        }));
        const newEdges: Edge[] = clip.edges.map((ed) => ({
          ...ed,
          id: `e${String(Date.now())}-${idMap.get(ed.source) ?? ed.source}-${idMap.get(ed.target) ?? ed.target}`,
          source: idMap.get(ed.source) ?? ed.source,
          target: idMap.get(ed.target) ?? ed.target,
        }));
        setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
        if (newEdges.length > 0) {
          setEdges((eds) => [...eds, ...newEdges]);
        }
        toast.success(`Pasted ${String(newNodes.length)} node${newNodes.length === 1 ? "" : "s"}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [
    handleUndo,
    handleRedo,
    selectedNodeId,
    selectedNodeIds,
    nodes,
    edges,
    settings,
    setNodes,
    setEdges,
    activeScenarioName,
    isRunning,
    handleRun,
    scenariosOpen,
    settingsOpen,
    comparison,
  ]);

  // VROL-784 — Miro / Figma-style single-letter station insertion. When
  // the cursor is over the canvas (or anywhere on the page, as long as no
  // input is focused), pressing `m`, `q`, `b`, … drops a fresh station at
  // the cursor position. `s` drops a sticky note; `f` drops a section
  // frame. Modifier-key presses (Cmd/Ctrl/Alt/Shift) are ignored so this
  // never collides with Cmd+C / Cmd+V / Cmd+A and friends above.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      const key = e.key.toLowerCase();
      if (key.length !== 1) return;

      // Resolve the insertion position. If the cursor is over the canvas
      // we use its flow-space position; otherwise we fall back to the
      // canvas centre.
      const wrapper = wrapperRef.current;
      const cursor = lastCanvasCursorRef.current;
      const screenPos = cursor
        ? { x: cursor.clientX, y: cursor.clientY }
        : wrapper
          ? (() => {
              const rect = wrapper.getBoundingClientRect();
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            })()
          : null;
      if (!screenPos) return;
      const pos = flow.screenToFlowPosition(screenPos);

      // Sticky note — separate from PALETTE in the UI too.
      if (key === "s") {
        e.preventDefault();
        const id = `n${String(nodeIdRef.current++)}`;
        const newNode: Node = {
          id,
          type: "sticky",
          position: pos,
          data: { text: "", color: "yellow" },
        };
        setNodes((ns) => ns.concat(newNode));
        toast.success("Inserted sticky note", {
          description: "Press M / Q / B and more for station shortcuts.",
        });
        return;
      }

      // Section frame.
      if (key === "f") {
        e.preventDefault();
        const id = `n${String(nodeIdRef.current++)}`;
        const newNode: Node = {
          id,
          type: "frame",
          position: pos,
          zIndex: -1,
          selectable: true,
          data: { label: "Section", color: "blue", width: 320, height: 200 },
        };
        setNodes((ns) => ns.concat(newNode));
        toast.success("Inserted section frame", {
          description: "Press M / Q / B and more for station shortcuts.",
        });
        return;
      }

      // Station palette.
      const item = PALETTE.find((p) => p.key === key);
      if (!item) return;
      e.preventDefault();
      const id = `n${String(nodeIdRef.current++)}`;
      const newNode: Node = {
        id,
        type: "station",
        // Mirror onDrop's offset so the node lands centred on the cursor.
        position: { x: pos.x - 90, y: pos.y - 30 },
        data: {
          label: item.label,
          stationType: item.stationType,
          cycleDistribution: constant(100),
          defectRate: 0,
          stationKey: generateStationKey(),
        },
      };
      setNodes((ns) => ns.concat(newNode));
      setSelectedNodeId(id);
      // Build the "press X for more" hint from the rest of the palette so
      // the toast surfaces a few more shortcuts the user might not know.
      const otherHints = PALETTE.filter((p) => p.key !== key)
        .slice(0, 3)
        .map((p) => p.keyHint)
        .join(" / ");
      toast.success(`Inserted ${item.label.toLowerCase()}`, {
        description: otherHints ? `Press ${otherHints} for more.` : undefined,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [flow, setNodes]);

  // VROL-304 — click a validation issue → pan + zoom the canvas to its node.
  const focusValidationIssue = useCallback(
    (iss: ValidationIssue) => {
      if (!iss.nodeId) return;
      const node = nodes.find((n) => n.id === iss.nodeId);
      if (!node) return;
      flow.setCenter(node.position.x + 75, node.position.y + 40, { zoom: 1.2, duration: 400 });
      setValidationOpen(false);
    },
    [flow, nodes],
  );

  // VROL-658 — apply a fix action from the validation panel.
  const applyValidationFix = useCallback(
    (iss: ValidationIssue) => {
      const action = iss.fixAction;
      if (!action) return;
      switch (action.kind) {
        case "delete-node":
          setNodes((ns) => ns.filter((n) => n.id !== action.nodeId));
          setEdges((es) =>
            es.filter((e) => e.source !== action.nodeId && e.target !== action.nodeId),
          );
          if (selectedNodeId === action.nodeId) setSelectedNodeId(null);
          break;
        case "delete-edge":
          setEdges((es) => es.filter((e) => e.id !== action.edgeId));
          break;
        case "clear-rework-target":
          setNodes((ns) =>
            ns.map((n) => {
              if (n.id !== action.nodeId) return n;
              const data = { ...(n.data as Record<string, unknown>) };
              delete data.reworkTargetNodeId;
              return { ...n, data };
            }),
          );
          break;
      }
    },
    [setNodes, setEdges, selectedNodeId],
  );

  // VROL-654 — load a saved comparison back into the sheet.
  const restoreComparison = useCallback((entry: ComparisonEntry) => {
    setComparison({
      aName: entry.aName,
      aResult: entry.aResult,
      aStationLabels: entry.aStationLabels,
      bName: entry.bName,
      bResult: entry.bResult,
      bStationLabels: entry.bStationLabels,
      horizonMs: entry.horizonMs,
      warmupMs: entry.warmupMs,
    });
  }, []);

  const deleteSavedComparison = useCallback((id: string) => {
    removeComparison(id);
    setSavedComparisons(listComparisons());
  }, []);

  const loadScenarioInto = useCallback(
    (name: string): boolean => {
      const payload = loadScenario(name);
      if (!payload) {
        toast.error("Couldn't load scenario");
        return false;
      }
      setNodes(ensureStationKeys([...payload.graph.nodes]));
      setEdges(payload.graph.edges);
      setSettings(payload.settings);
      setSelectedNodeId(null);
      setResult(null);
      setRunMeta(null);
      setActiveScenarioName(name);
      // VROL-789 — mark this scenario as recently used so the Scenarios drawer
      // can surface the last 2 as primary buttons.
      markScenarioUsed(name);
      setScenarios(listScenarios());
      nodeIdRef.current =
        payload.graph.nodes.reduce(
          (max, n) => Math.max(max, parseInt(n.id.replace(/\D/g, ""), 10) || 0),
          0,
        ) + 1;
      setScenariosOpen(false);
      toast.success(`Loaded "${name}"`);
      return true;
    },
    [setNodes, setEdges, setSettings],
  );

  // VROL-630 — load a Preset by deep-copying its graph + settings. Presets
  // themselves are read-only; this hands the user an editable copy that's
  // identical to "load a manually-saved scenario."
  const loadPresetInto = useCallback(
    (preset: Preset): void => {
      const nodesCopy = preset.graph.nodes.map((n) => ({ ...n, data: { ...n.data } }));
      const edgesCopy = preset.graph.edges.map((e) => ({ ...e }));
      setNodes(ensureStationKeys(nodesCopy));
      setEdges(edgesCopy);
      setSettings({ ...preset.settings });
      setSelectedNodeId(null);
      setResult(null);
      setRunMeta(null);
      setActiveScenarioName(null);
      nodeIdRef.current =
        nodesCopy.reduce((max, n) => Math.max(max, parseInt(n.id.replace(/\D/g, ""), 10) || 0), 0) +
        1;
      setScenariosOpen(false);
      toast.success(`Loaded preset "${preset.title}"`);
    },
    [setNodes, setEdges, setSettings],
  );

  // VROL-630 — surface a toast so the user knows they're looking at a
  // preset (initial state was already seeded above). Runs once on mount.
  const presetTitle = initial.presetTitle;
  useEffect(() => {
    if (presetTitle) toast.success(`Loaded preset "${presetTitle}"`);
  }, [presetTitle]);

  // Detect whether the canvas + settings have drifted from the active scenario's
  // snapshot. Cheap deep-compare via JSON.stringify; only computed when a
  // scenario is loaded.
  const activeScenarioIsModified = useMemo(() => {
    if (!activeScenarioName || !activeScenarioSnapshot) return false;
    const current = JSON.stringify({ graph: { nodes, edges }, settings });
    return current !== activeScenarioSnapshot;
  }, [activeScenarioName, activeScenarioSnapshot, nodes, edges, settings]);
  // VROL-696 — compact diff hint vs the saved snapshot: counts how many
  // nodes / edges / settings keys differ. Used in the toolbar pill hover.
  const activeScenarioDiff = useMemo(() => {
    if (!activeScenarioIsModified || !activeScenarioSnapshot) return null;
    try {
      const saved = JSON.parse(activeScenarioSnapshot) as {
        graph: { nodes: Node[]; edges: Edge[] };
        settings: Record<string, unknown>;
      };
      const savedNodeJson = new Map(saved.graph.nodes.map((n) => [n.id, JSON.stringify(n)]));
      const currentNodeJson = new Map(nodes.map((n) => [n.id, JSON.stringify(n)]));
      let nodeChanges = 0;
      for (const [id, j] of currentNodeJson) {
        if (savedNodeJson.get(id) !== j) nodeChanges++;
      }
      for (const id of savedNodeJson.keys()) {
        if (!currentNodeJson.has(id)) nodeChanges++;
      }
      const savedEdgeIds = new Set(saved.graph.edges.map((e) => e.id));
      const currentEdgeIds = new Set(edges.map((e) => e.id));
      let edgeChanges = 0;
      for (const id of currentEdgeIds) if (!savedEdgeIds.has(id)) edgeChanges++;
      for (const id of savedEdgeIds) if (!currentEdgeIds.has(id)) edgeChanges++;
      const currentSettingsKeys = Object.keys(settings) as readonly string[];
      let settingsChanges = 0;
      for (const k of currentSettingsKeys) {
        if (
          JSON.stringify((settings as Record<string, unknown>)[k]) !==
          JSON.stringify(saved.settings[k])
        ) {
          settingsChanges++;
        }
      }
      return { nodeChanges, edgeChanges, settingsChanges };
    } catch {
      return null;
    }
  }, [activeScenarioIsModified, activeScenarioSnapshot, nodes, edges, settings]);

  // Render edges with per-edge throughput labels from the last run, if we have one.
  // When animateFlow is on, also assign the animated custom edge type so dots
  // travel along the path at a speed tied to the edge's flow rate.
  // VROL-614 — feed each station's cumulative-completed series into its node
  // data so StationNode can render a sparkline. Hidden when no result, no
  // samples, or the station isn't on the analysed chain.
  // VROL-304 — live validation. Runs on every nodes/edges/settings change.
  // memo dedup makes it cheap; the heavy check is O(nodes + edges) anyway.
  const validation = useMemo(
    () => validateScenario(nodes, edges, settings),
    [nodes, edges, settings],
  );
  // VROL-304 — per-node max-severity map for inline canvas indicators.
  const severityByNodeId = useMemo(() => {
    const map = new Map<string, "error" | "warning">();
    for (const iss of [...validation.errors, ...validation.warnings]) {
      if (!iss.nodeId) continue;
      const prev = map.get(iss.nodeId);
      // error beats warning; same severity is a no-op.
      if (iss.severity === "error" || prev !== "error") map.set(iss.nodeId, iss.severity);
    }
    return map;
  }, [validation]);

  const nodesForFlow = useMemo<Node[]>(() => {
    const sevMap = severityByNodeId;
    // Build base nodes either from sparkline enrichment or just the raw nodes.
    const idxByNodeId = new Map<string, number>();
    if (result && runMeta && result.samples.length > 0) {
      runMeta.chainNodeIds.forEach((id, i) => idxByNodeId.set(id, i));
    }
    return nodes.map((n) => {
      const stationIdx = idxByNodeId.get(n.id);
      const baseData = n.data as Record<string, unknown>;
      // sparklineSeries enrichment (VROL-614).
      let nextData: Record<string, unknown> = baseData;
      if (result && runMeta && result.samples.length > 0) {
        if (stationIdx === undefined) {
          if ("sparklineSeries" in baseData) {
            const stripped = { ...baseData };
            delete stripped.sparklineSeries;
            nextData = stripped;
          }
        } else {
          const series = result.samples.map((s) => s.perStationCompleted[stationIdx] ?? 0);
          nextData = { ...baseData, sparklineSeries: series };
        }
      }
      // VROL-893 — per-station state-mix sourced from result.bottlenecks (which
      // carries a stationId → breakdown array). The state mix actually differs
      // per station, unlike cumulative throughput which is identical in steady
      // state.
      if (result) {
        const mix = result.bottlenecks.find((b) => b.stationId === n.id)?.breakdown;
        if (mix && mix.length > 0) {
          if (nextData === baseData) nextData = { ...baseData };
          nextData = {
            ...nextData,
            stateMix: mix.map((seg) => ({ state: seg.state, pct: seg.pct })),
          };
        } else if ("stateMix" in nextData) {
          const stripped = { ...nextData };
          delete stripped.stateMix;
          nextData = stripped;
        }
      } else if ("stateMix" in nextData) {
        const stripped = { ...nextData };
        delete stripped.stateMix;
        nextData = stripped;
      }
      // VROL-304 — validation severity (overlay applies regardless of result).
      const sev = sevMap.get(n.id);
      if (sev) {
        if (nextData === baseData) nextData = { ...baseData };
        nextData = { ...nextData, _validationSeverity: sev };
      } else if ("_validationSeverity" in nextData) {
        const stripped = { ...nextData };
        delete stripped._validationSeverity;
        nextData = stripped;
      }
      // VROL-692 — mark the bottleneck station so the renderer can show a pulse.
      // VROL-895 / VROL-900 — use result.bottlenecks[0], which is now sorted
      // by bindingScore (= runningPct × nominalSpeedRatio). Captures both
      // util-driven bottlenecks (unbalanced lines) and performance-driven
      // bottlenecks (balanced lines where the at-nominal-max station is the
      // real constraint).
      const empiricalBottleneckStationId =
        result && result.bottlenecks.length > 0 ? result.bottlenecks[0]?.stationId : undefined;
      if (result && runMeta && n.id === empiricalBottleneckStationId) {
        if (nextData === baseData) nextData = { ...baseData };
        nextData = { ...nextData, _isBottleneck: true };
      } else if ("_isBottleneck" in nextData) {
        const stripped = { ...nextData };
        delete stripped._isBottleneck;
        nextData = stripped;
      }
      // VROL-901 — inject the per-station nominalSpeedRatio so the renderer
      // can show a "Throttled / X% nominal" chip when ratio < 0.95. Only
      // surfaces when the user actually set nominalCycleTimeMs; legacy
      // stations report ratio 1.0 and the chip stays hidden.
      if (result) {
        const ratio = result.bottlenecks.find((b) => b.stationId === n.id)?.nominalSpeedRatio;
        if (typeof ratio === "number" && ratio < 0.95) {
          if (nextData === baseData) nextData = { ...baseData };
          nextData = { ...nextData, _nominalSpeedRatio: ratio };
        } else if ("_nominalSpeedRatio" in nextData) {
          const stripped = { ...nextData };
          delete stripped._nominalSpeedRatio;
          nextData = stripped;
        }
      } else if ("_nominalSpeedRatio" in nextData) {
        const stripped = { ...nextData };
        delete stripped._nominalSpeedRatio;
        nextData = stripped;
      }
      // Live playback — paint the station with its current dominant state.
      if (
        playbackSnapshot &&
        stationIdx !== undefined &&
        stationIdx < playbackSnapshot.perStationState.length
      ) {
        if (nextData === baseData) nextData = { ...baseData };
        nextData = {
          ...nextData,
          _playbackState: playbackSnapshot.perStationState[stationIdx],
        };
      } else if ("_playbackState" in nextData) {
        const stripped = { ...nextData };
        delete stripped._playbackState;
        nextData = stripped;
      }
      if (nextData === baseData) return n;
      return { ...n, data: nextData };
    });
  }, [nodes, result, runMeta, severityByNodeId, playbackSnapshot]);

  const edgesForFlow = useMemo<Edge[]>(() => {
    if (!result || !runMeta || result.elapsedMs <= 0) return edges;
    const flowByKey = new Map<string, number>();
    const edgeIdxByKey = new Map<string, number>();
    runMeta.edgeKeys.forEach((key, i) => {
      flowByKey.set(key, result.perEdgeFlowed[i] ?? 0);
      edgeIdxByKey.set(key, i);
    });
    // VROL-609 — tint animated dots by the worst-station's primary reason
    // so a clean run paints green and a breakdown-heavy run paints red.
    const primaryReason = result.bottlenecks[0]?.primaryReason ?? "running";
    const dotColorClass =
      primaryReason === "breakdown"
        ? "text-sim-down"
        : primaryReason === "setup"
          ? "text-sim-setup"
          : primaryReason === "maintenance"
            ? "text-sim-maintenance"
            : primaryReason === "blocking" || primaryReason === "starvation"
              ? "text-sim-blocked"
              : "text-sim-running";
    // VROL-615 — collect per-edge buffer fill series when the sampler ran.
    const hasSamples = result.samples.length > 1;
    return edges.map((e) => {
      const key = `${e.source}→${e.target}`;
      const flowed = flowByKey.get(key);
      if (flowed === undefined) return e;
      const flowRate = result.elapsedMs > 0 ? flowed / result.elapsedMs : 0;
      const perHour = (flowed / result.elapsedMs) * 3_600_000;
      const label = `${perHour.toLocaleString("en-US", { maximumFractionDigits: 0 })}/h`;
      const edgeIdx = edgeIdxByKey.get(key);
      const bufferFillSeries =
        hasSamples && edgeIdx !== undefined
          ? result.samples.map((s) => s.perEdgeBufferFill[edgeIdx] ?? 0)
          : undefined;
      // VROL-693 — peak fill summary appended to the edge label so users see
      // "throughput/h · peak N" on each edge once a run has data.
      const bufferPeak = bufferFillSeries ? Math.max(0, ...bufferFillSeries) : 0;
      const labelWithPeak = bufferPeak > 0 ? `${label} · peak ${String(bufferPeak)}` : label;
      // Live playback — current buffer fill drives both edge stroke width
      // and dot color so the canvas reads like a live simulation.
      const playbackFillNow =
        playbackSnapshot && edgeIdx !== undefined
          ? (playbackSnapshot.perEdgeFill[edgeIdx] ?? 0)
          : 0;
      // Switch to AnimatedEdge whenever we have something to render on top of
      // the stock edge — dots (animateFlow on) OR a buffer-fill sparkline OR
      // a live playback fill.
      const usesCustomEdge =
        (animateFlow && flowed > 0) || bufferFillSeries !== undefined || playbackSnapshot !== null;
      return {
        ...e,
        label: labelWithPeak,
        animated: !usesCustomEdge && flowed > 0,
        ...(usesCustomEdge
          ? {
              type: "animated",
              data: {
                ...e.data,
                flowRate: animateFlow ? flowRate : 0,
                dotColorClass,
                ...(bufferFillSeries ? { bufferFillSeries } : {}),
                ...(playbackSnapshot ? { playbackFillNow, playbackPeak: bufferPeak } : {}),
              },
            }
          : {}),
      };
    });
  }, [edges, result, runMeta, animateFlow, playbackSnapshot]);

  // Sprint 90 — Raise the selected edge to the end of the array so its
  // SVG renders LAST (on top). Two edges converging on the same handle
  // would otherwise share a hit zone and the click always picks the same
  // one regardless of where the user is hovering.
  const edgesForFlowOrdered = useMemo<Edge[]>(() => {
    if (!selectedEdgeId) return edgesForFlow;
    const idx = edgesForFlow.findIndex((e) => e.id === selectedEdgeId);
    if (idx < 0) return edgesForFlow;
    const front = edgesForFlow[idx];
    if (!front) return edgesForFlow;
    return [...edgesForFlow.slice(0, idx), ...edgesForFlow.slice(idx + 1), front];
  }, [edgesForFlow, selectedEdgeId]);

  // VROL-634 — derive top-bar status pill state. Idle until first run; pulses
  // while a run is in flight; stays "Done at HH:MM:SS" after completion.
  // Uses the same render-time compare-and-set pattern as VROL-621 to capture
  // the wall-clock time of each new result without firing setState from a
  // useEffect (which the react-hooks/set-state-in-effect rule rejects).
  const [doneAt, setDoneAt] = useState<Date | null>(null);
  const [lastResultSeen, setLastResultSeen] = useState<ChainResult | null>(null);
  if (result !== lastResultSeen) {
    setLastResultSeen(result);
    setDoneAt(result ? new Date() : null);
  }

  // VROL-634 — secondary actions ("More") menu state + outside-click handler.
  const [moreOpen, setMoreOpen] = useState<boolean>(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target;
      if (moreRef.current && target instanceof Node && moreRef.current.contains(target)) return;
      setMoreOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [moreOpen]);

  const downloadJson = useCallback(() => {
    if (!result || !runMeta) return;
    const stem = suggestedFilenameStem(runMeta.stationLabels[0]);
    downloadFile(`${stem}.json`, chainResultToJsonString(result), "application/json");
    toast.success("Downloaded JSON");
    setMoreOpen(false);
  }, [result, runMeta]);
  const downloadCsvStations = useCallback(() => {
    if (!result || !runMeta) return;
    const stem = suggestedFilenameStem(runMeta.stationLabels[0]);
    downloadFile(
      `${stem}.csv`,
      chainResultToCsv(result, { stationLabels: runMeta.stationLabels }),
      "text/csv",
    );
    toast.success("Downloaded CSV");
    setMoreOpen(false);
  }, [result, runMeta]);
  // VROL-683 — line + per-station combined summary CSV.
  const downloadCsvSummary = useCallback(() => {
    if (!result || !runMeta) return;
    const stem = suggestedFilenameStem(runMeta.stationLabels[0]);
    downloadFile(
      `${stem}-summary.csv`,
      resultToSummaryCsv(result, runMeta.stationLabels),
      "text/csv",
    );
    toast.success("Downloaded summary CSV");
    setMoreOpen(false);
  }, [result, runMeta]);
  const downloadCsvSamples = useCallback(() => {
    if (!result || !runMeta || result.samples.length <= 1) return;
    const stem = suggestedFilenameStem(runMeta.stationLabels[0]);
    downloadFile(
      `${stem}-samples.csv`,
      chainResultToCsv(result, { stationLabels: runMeta.stationLabels, mode: "samples" }),
      "text/csv",
    );
    toast.success("Downloaded timeseries CSV");
    setMoreOpen(false);
  }, [result, runMeta]);

  // VROL-811 — central editor action registry. All actions (Run, Undo,
  // Save, Duplicate, Auto-layout, Fit view, Open scenarios, …) are defined
  // ONCE here through `defineActions(handlers)`. Every surface — toolbar,
  // command palette, right-click menu, keyboard shortcuts overlay — derives
  // from this single list so adding or renaming an action is a 1-file
  // change. The host (this component) owns the side effects through these
  // thin handler closures.
  //
  // NOT memoed: handlers capture live refs (wrapperRef, nodeIdRef, flow)
  // that mustn't be touched during render; a fresh array per render keeps
  // the refs strictly inside closures.
  const editorActionHandlers: EditorActionHandlers = {
    run: () => {
      if (!isRunning) handleRun();
    },
    newSeed: () => {
      // eslint-disable-next-line react-hooks/purity -- arrow body only runs on user action, not during render.
      const next = Math.floor(Math.random() * 2_147_483_647);
      setSettings((s) => ({ ...s, seed: next }));
      setTimeout(() => {
        if (!isRunning) handleRun();
      }, 0);
    },
    undo: () => {
      handleUndo();
    },
    redo: () => {
      handleRedo();
    },
    save: () => {
      if (!activeScenarioName) {
        setSaveNameDialogOpen(true);
        return;
      }
      try {
        saveScenario(activeScenarioName, {
          graph: { nodes: [...nodes], edges: [...edges] },
          settings,
          // eslint-disable-next-line react-hooks/purity -- runs on user action, not render.
          savedAtMs: Date.now(),
        });
        setScenarios(listScenarios());
        setActiveScenarioSnapshot(JSON.stringify({ graph: { nodes, edges }, settings }));
        toast.success("Saved");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        toast.error("Save failed", { description: m });
      }
    },
    saveAs: () => {
      setSaveNameDialogOpen(true);
    },
    saveAndExit: () => {
      if (!activeScenarioName) {
        setSaveNameDialogOpen(true);
        return;
      }
      try {
        saveScenario(activeScenarioName, {
          graph: { nodes: [...nodes], edges: [...edges] },
          settings,
          // eslint-disable-next-line react-hooks/purity -- runs on user action, not render.
          savedAtMs: Date.now(),
        });
        toast.success("Saved");
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        toast.error("Save failed", { description: m });
        return;
      }
      if (typeof window !== "undefined") {
        window.history.pushState({}, "", "/");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
    },
    duplicate: () => {
      const selected = nodes.filter((n) => n.selected);
      const target = selected.length > 0 ? selected : nodes.filter((n) => n.id === selectedNodeId);
      if (target.length === 0) return;
      const newNodes: Node[] = target.map((original) => {
        const newId = `n${String(nodeIdRef.current++)}`;
        return {
          ...original,
          id: newId,
          position: { x: original.position.x + 60, y: original.position.y + 60 },
          selected: false,
          data: { ...(original.data as Record<string, unknown>) },
        };
      });
      setNodes((ns) => [...ns, ...newNodes]);
      const first = newNodes[0];
      if (first) setSelectedNodeId(first.id);
      toast.success(
        `Duplicated ${String(newNodes.length)} station${newNodes.length === 1 ? "" : "s"}`,
      );
    },
    deleteSelection: () => {
      const selectedIds = new Set(
        nodes.filter((n) => n.selected || n.id === selectedNodeId).map((n) => n.id),
      );
      if (selectedIds.size === 0) return;
      setNodes((ns) => ns.filter((n) => !selectedIds.has(n.id)));
      setEdges((es) =>
        es.filter((ed) => !selectedIds.has(ed.source) && !selectedIds.has(ed.target)),
      );
      setSelectedNodeId(null);
    },
    selectAll: () => {
      setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
    },
    deselect: () => {
      setNodes((ns) => ns.map((n) => ({ ...n, selected: false })));
      setSelectedNodeId(null);
    },
    autoLayout: () => {
      runAutoLayout();
    },
    fitView: () => {
      flow.fitView({ duration: 400, padding: 0.2 });
    },
    zoomIn: () => {
      flow.zoomIn();
    },
    zoomOut: () => {
      flow.zoomOut();
    },
    toggleLock: () => {
      toggleLock();
    },
    openScenarios: () => {
      setScenariosOpen(true);
    },
    openRunSettings: () => {
      setSettingsOpen(true);
    },
    openWizard: () => {
      setWizardOpen(true);
    },
    togglePalette: () => {
      setCommandOpen((v) => !v);
    },
    resetCanvas: () => {
      handleReset();
    },
  };
  // eslint-disable-next-line react-hooks/refs -- handlers close over live refs (wrapperRef, nodeIdRef, flow). defineActions stores them in closures; nothing is read at render time.
  const editorActions: readonly EditorAction[] = defineActions(editorActionHandlers);
  const editorActionContext: EditorActionContext = {
    hasSelection: nodes.some((n) => n.selected) || selectedNodeId !== null,
    hasNodes: nodes.length > 0,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    isRunning,
    scenarioName: activeScenarioName,
  };
  /**
   * Route a presentational toolbar button through the registry so the side
   * effect lives in one place. Bails when the action's `isDisabled(ctx)` is
   * true so the button can't fire while it advertises a disabled visual.
   */
  const dispatchAction = (id: string): void => {
    const a = editorActions.find((x) => x.id === id);
    if (!a) return;
    if (a.isDisabled?.(editorActionContext)) return;
    a.run(editorActionContext);
  };
  const commandActions: readonly CommandAction[] = (() => {
    const list: CommandAction[] = [];
    // Insert-station palette items are dynamic per the available PALETTE
    // and don't belong in the editor action registry. They get appended to
    // the palette's surface list directly. The closure body calls a
    // useCallback so no refs are touched here at render time — the
    // react-hooks/refs lint rule is over-eager about useCallback
    // boundaries, hence the disable.
    for (const p of PALETTE) {
      // eslint-disable-next-line react-hooks/refs
      list.push({
        id: `insert:${p.stationType}`,
        label: `Insert ${p.label}`,
        hint: p.summary,
        group: "Insert",
        run: () => {
          insertStationFromCenter(p);
        },
      });
    }
    for (const cmd of adaptToCommandPalette(editorActions, editorActionContext)) {
      list.push(cmd);
    }
    return list;
  })();

  // Alignment toolbar anchor — top-mid of the selection bbox, expressed in
  // wrapper-relative coords so the toolbar mounts as position:absolute inside
  // the canvas wrapper (no viewport-rect ref reads during render needed).
  const alignmentAnchor = useMemo<{ left: number; top: number } | null>(() => {
    const selected = nodes.filter((n) => n.selected);
    if (selected.length < 2) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    for (const n of selected) {
      const w = n.width ?? n.measured?.width ?? 180;
      const r = n.position.x + w;
      if (n.position.x < minX) minX = n.position.x;
      if (n.position.y < minY) minY = n.position.y;
      if (r > maxX) maxX = r;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX)) return null;
    const midX = (minX + maxX) / 2;
    return {
      left: midX * viewport.zoom + viewport.x,
      top: minY * viewport.zoom + viewport.y,
    };
  }, [nodes, viewport.x, viewport.y, viewport.zoom]);

  // Edge floating toolbar anchor — X centred between the two endpoints, Y
  // placed above the TOPMOST endpoint (smaller flow-y) so the toolbar
  // never sits on top of the line itself. The toolbar component subtracts
  // its own height + a gap, so we anchor at the node top.
  /* eslint-disable react-hooks/refs -- wrapper rect translates flow-space →
     viewport-space for fixed-positioning the floating edge toolbar. No
     React-state equivalent without an extra ResizeObserver layer. */
  const edgeToolbarAnchor = useMemo<{ x: number; y: number } | null>(() => {
    if (!selectedEdgeId) return null;
    const edge = edges.find((e) => e.id === selectedEdgeId);
    if (!edge) return null;
    const s = nodes.find((n) => n.id === edge.source);
    const t = nodes.find((n) => n.id === edge.target);
    if (!s || !t) return null;
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const sw = s.width ?? s.measured?.width ?? 180;
    const tw = t.width ?? t.measured?.width ?? 180;
    const sx = s.position.x + sw / 2;
    const tx = t.position.x + tw / 2;
    const midX = (sx + tx) / 2;
    // Highest endpoint (smallest flow-y) — the toolbar floats ABOVE this.
    const topY = Math.min(s.position.y, t.position.y);
    return {
      x: rect.left + midX * viewport.zoom + viewport.x,
      y: rect.top + topY * viewport.zoom + viewport.y,
    };
  }, [selectedEdgeId, edges, nodes, viewport.x, viewport.y, viewport.zoom]);
  /* eslint-enable react-hooks/refs */

  const selectedEdge = useMemo<Edge | null>(() => {
    if (!selectedEdgeId) return null;
    return edges.find((e) => e.id === selectedEdgeId) ?? null;
  }, [selectedEdgeId, edges]);

  const updateSelectedEdgeData = useCallback(
    (patch: Record<string, unknown>) => {
      if (!selectedEdgeId) return;
      setEdges((es) =>
        es.map((e) =>
          e.id === selectedEdgeId
            ? {
                ...e,
                data: {
                  ...(e.data ?? {}),
                  ...patch,
                },
              }
            : e,
        ),
      );
    },
    [selectedEdgeId, setEdges],
  );

  // Sprint 85 — quickAddAnchor + handleQuickAdd removed. Ghost quick-add
  // suggestion tiles were intrusive on every node click. Drag-from-handle,
  // station palette, and wizard cover the same ground.

  return (
    <div className="space-y-3">
      {/* VROL-632 — first-run onboarding tour. Renders nothing when !tourOpen. */}
      <OnboardingTour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
        }}
      />
      {/* VROL-432 — offline banner: appears above the toolbar when the
          browser reports offline. Run + edits stay enabled (everything is
          local-first); only flags cloud-sync / AI as paused. */}
      {!isOnline ? (
        <div
          className="border-sim-down/40 bg-sim-down/5 text-sim-down-foreground -mx-6 border-b px-6 py-1.5 text-xs"
          role="status"
        >
          <strong>Offline</strong> — edits + runs continue locally. Cloud sync and AI assistance are
          paused.
        </div>
      ) : null}
      {/* VROL-634 — sticky top bar: scenario name + status pill + primary
          actions. Replaces the 9-button stack that used to live in the left
          column with a horizontal action hierarchy. */}
      <div
        role="toolbar"
        aria-label="Scenario actions"
        className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 sticky top-0 z-20 -mx-6 flex flex-wrap items-center gap-2 border-b px-3 py-2 backdrop-blur sm:gap-3 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground/80 truncate text-sm font-semibold">
            {activeScenarioName ?? "Untitled scenario"}
          </span>
          {/* VROL-774 — the static "Saved" chip was decorative noise (autosave
              to localStorage never fails visibly). The "modified" chip below
              is the meaningful state signal. */}
          {activeScenarioName && activeScenarioIsModified ? (
            <span
              className="bg-sim-setup/20 text-sim-setup-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              title={
                activeScenarioDiff
                  ? `Modified vs saved: ${String(activeScenarioDiff.nodeChanges)} node${activeScenarioDiff.nodeChanges === 1 ? "" : "s"}, ${String(activeScenarioDiff.edgeChanges)} edge${activeScenarioDiff.edgeChanges === 1 ? "" : "s"}, ${String(activeScenarioDiff.settingsChanges)} setting${activeScenarioDiff.settingsChanges === 1 ? "" : "s"}`
                  : "Modified vs saved"
              }
            >
              modified
              {activeScenarioDiff
                ? ` · ${String(activeScenarioDiff.nodeChanges + activeScenarioDiff.edgeChanges + activeScenarioDiff.settingsChanges)} Δ`
                : ""}
            </span>
          ) : null}
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            isRunning
              ? "bg-sim-running/20 text-sim-running"
              : result
                ? "bg-sim-running/15 text-foreground"
                : "bg-muted text-muted-foreground"
          }`}
          aria-live="polite"
        >
          {isRunning ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Running…
            </>
          ) : result && doneAt ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              {/* VROL-705 — pill text shows throughput + OEE summary, not just the time. */}
              {Math.round(result.throughputLambda * 3_600_000).toLocaleString()}
              /h · Eff {(result.lineOee * 100).toFixed(0)}%
              <span className="text-muted-foreground ml-1.5 hidden font-mono text-[10px] sm:inline">
                {doneAt.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {/* VROL-718 — explicit screen-reader-only announcement spelled out. */}
              <span className="sr-only">
                Simulation complete. {result.completed.toLocaleString()} parts. Throughput{" "}
                {Math.round(result.throughputLambda * 3_600_000).toLocaleString()} per hour. Line
                efficiency {(result.lineOee * 100).toFixed(0)} percent.
              </span>
            </>
          ) : (
            <>
              <CircleDot className="h-3 w-3" />
              Idle
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* VROL-728 — auto-layout: arrange nodes left-to-right by topological depth. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (nodes.length === 0) {
                toast.info("Canvas is empty");
                return;
              }
              const depth = new Map<string, number>();
              const idToNode = new Map(nodes.map((n) => [n.id, n]));
              const order = [...nodes].map((n) => n.id);
              for (const id of order) {
                if (!depth.has(id)) depth.set(id, 0);
              }
              let changed = true;
              let iters = 0;
              while (changed && iters < 100) {
                changed = false;
                iters++;
                for (const e of edges) {
                  const s = depth.get(e.source) ?? 0;
                  const t = depth.get(e.target) ?? 0;
                  if (t < s + 1) {
                    depth.set(e.target, s + 1);
                    changed = true;
                  }
                }
              }
              const cols = new Map<number, string[]>();
              for (const id of order) {
                const d = depth.get(id) ?? 0;
                const arr = cols.get(d) ?? [];
                arr.push(id);
                cols.set(d, arr);
              }
              const NX = 220;
              const NY = 120;
              setNodes((ns) =>
                ns.map((n) => {
                  const d = depth.get(n.id) ?? 0;
                  const colIds = cols.get(d) ?? [];
                  const rank = colIds.indexOf(n.id);
                  const original = idToNode.get(n.id);
                  if (!original) return n;
                  return {
                    ...n,
                    position: { x: 40 + d * NX, y: 40 + rank * NY },
                  };
                }),
              );
              toast.success("Auto-layout applied");
            }}
            title="Arrange nodes left-to-right by depth"
          >
            Auto-layout
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setTourOpen(true);
            }}
            aria-label="Restart the tour"
            title="Tour"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setWizardOpen(true);
            }}
            className="gap-2"
            title="Build a scenario with the guided wizard"
          >
            <Wand2 className="h-4 w-4" />
            Wizard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSettingsOpen(true);
            }}
            className="gap-2"
            data-tour="run-settings"
          >
            <Settings2 className="h-4 w-4" />
            Run settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setScenarios(listScenarios());
              setScenariosOpen(true);
            }}
            className="gap-2"
            data-tour="scenarios"
          >
            <FolderOpen className="h-4 w-4" />
            Scenarios
          </Button>
          <div ref={moreRef} className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setMoreOpen((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
            {moreOpen ? (
              <div
                role="menu"
                className="border-border bg-popover absolute right-0 z-30 mt-1 w-56 rounded-md border p-1 shadow-md"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-50"
                  onClick={() => {
                    setMoreOpen(false);
                    setConfirmReset(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Reset canvas
                </button>
                {result && runMeta ? (
                  <>
                    <div className="border-border my-1 border-t" />
                    <button
                      type="button"
                      role="menuitem"
                      className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                      onClick={downloadJson}
                    >
                      <Download className="h-4 w-4" />
                      Download JSON
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                      onClick={downloadCsvStations}
                    >
                      <Download className="h-4 w-4" />
                      CSV (per station)
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                      onClick={downloadCsvSummary}
                    >
                      <Download className="h-4 w-4" />
                      CSV (KPI summary)
                    </button>
                    {result.samples.length > 1 ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                        onClick={downloadCsvSamples}
                      >
                        <Download className="h-4 w-4" />
                        CSV (timeseries)
                      </button>
                    ) : null}
                    <div className="border-border my-1 border-t" />
                    <label className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={animateFlow}
                        onChange={(e) => {
                          setAnimateFlow(e.target.checked);
                        }}
                        className="accent-sim-running h-4 w-4"
                      />
                      Animate flow on edges
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {confirmReset ? (
            <div
              ref={(el) => {
                confirmTargetRef.current = el;
              }}
              className="bg-card border-border flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">Reset?</span>
              <Button
                size="sm"
                onClick={() => {
                  setConfirmReset(false);
                  handleReset();
                }}
              >
                Yes
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConfirmReset(false);
                }}
              >
                No
              </Button>
            </div>
          ) : null}
          {/* VROL-309 — undo / redo. Always visible; disabled when stack is empty.
              VROL-811 — onClick routes through the central action registry so
              the side effect lives in one place. */}
          <div className="flex items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                dispatchAction("undo");
              }}
              disabled={!canUndo(history)}
              title="Undo (⌘Z)"
              aria-label="Undo"
              className="rounded-r-none border-r-0 px-2"
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                dispatchAction("redo");
              }}
              disabled={!canRedo(history)}
              title="Redo (⇧⌘Z)"
              aria-label="Redo"
              className="rounded-l-none px-2"
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          {/* VROL-304 / VROL-780 — validation badge in a render-locked slot.
              The slot is always present in the top-bar (fixed min-width) so
              the chip + popover never get re-mounted by neighbouring
              re-renders — only the chip's CONTENT updates. The popover stays
              mounted while open so the user keeps their scroll position +
              focus across validation-state changes. */}
          <div
            className="relative flex h-8 min-w-[7rem] items-center justify-end"
            data-testid="validation-slot"
          >
            {validation.errors.length + validation.warnings.length > 0 ? (
              <button
                type="button"
                id="validation-trigger"
                onClick={() => {
                  setValidationOpen((v) => !v);
                }}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${
                  validation.errors.length > 0
                    ? "border-sim-down/40 bg-sim-down/10 text-sim-down-foreground"
                    : "border-sim-setup/40 bg-sim-setup/10 text-sim-setup-foreground"
                }`}
                aria-label={`${String(validation.errors.length)} errors, ${String(validation.warnings.length)} warnings`}
                aria-expanded={validationOpen}
                aria-controls="validation-popover"
                // VROL-721 — live region so screen-reader users hear updates.
                aria-live="polite"
                title="Open validation panel"
                data-testid="validation-trigger"
              >
                {validation.errors.length > 0 ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                {validation.errors.length > 0
                  ? `${String(validation.errors.length)} ${validation.errors.length === 1 ? "error" : "errors"}`
                  : null}
                {validation.errors.length > 0 && validation.warnings.length > 0 ? " · " : null}
                {validation.warnings.length > 0
                  ? `${String(validation.warnings.length)} ${validation.warnings.length === 1 ? "warning" : "warnings"}`
                  : null}
              </button>
            ) : null}
            {validationOpen ? (
              <div
                id="validation-popover"
                role="dialog"
                aria-labelledby="validation-trigger"
                className="border-border bg-card absolute top-full right-0 z-40 mt-1 w-96 rounded-md border shadow-lg"
                data-testid="validation-popover"
              >
                <ValidationPanel
                  result={validation}
                  onIssueFocus={focusValidationIssue}
                  onIssueFix={applyValidationFix}
                  onFixAll={(issues) => {
                    for (const iss of issues) applyValidationFix(iss);
                    toast.success(`Applied ${String(issues.length)} fixes`);
                  }}
                />
              </div>
            ) : null}
          </div>
          {/* VROL-774 — Run is the primary action in the top bar. Default
              size + variant + a primary-tinted ring make it the obvious
              call-to-action against the surrounding ghost / outline chrome.
              VROL-811 — onClick routes through the central action registry
              so the side effect (run sim) lives in one place. */}
          <Button
            onClick={() => {
              dispatchAction("run");
            }}
            disabled={isRunning}
            className="ring-primary/20 hover:ring-primary/40 gap-2 shadow-sm ring-2"
            size="default"
            variant="default"
            data-tour="run-button"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning ? "Running" : "Run"}
          </Button>
          {/* VROL-689 + VROL-892 — re-roll the PRNG seed and immediately
              re-run. Reframed as "Try another draw" — non-technical users
              don't care that there's a seed; they care that they can
              shake the dice and see if the result holds up. */}
          <Button
            variant="outline"
            size="sm"
            disabled={isRunning}
            className="gap-2"
            aria-label="Re-run with a new random draw"
            title="Same setup, different random draw — useful for sanity-checking whether your result is robust or lucky"
            onClick={() => {
              const next = Math.floor(Math.random() * 1_000_000);
              setSettings((s) => ({ ...s, seed: next }));
              setTimeout(() => {
                handleRun();
              }, 0);
            }}
          >
            <Sparkles className="h-4 w-4" />
            Try another draw
          </Button>
        </div>
      </div>
      {/* VROL-778 — pinned 6-tile KPI strip. Stays visible below the
          toolbar while the user edits so they never lose sight of the
          headline metrics from the last run. Hidden until the first run
          produces a result. */}
      {result && runMeta ? (
        <div
          role="group"
          aria-label="Last run KPIs"
          className="border-border bg-card/70 supports-[backdrop-filter]:bg-card/55 sticky top-[3.25rem] z-10 -mx-6 grid grid-cols-3 gap-2 border-b px-3 py-2 backdrop-blur sm:grid-cols-6 sm:gap-3 sm:px-6"
        >
          {(() => {
            const tput = Math.round(result.throughputLambda * 3_600_000);
            const oeePct = (result.lineOee * 100).toFixed(0);
            const tisMs = result.avgTimeInSystemW;
            const tisLabel =
              tisMs >= 1000 ? `${(tisMs / 1000).toFixed(1)}s` : `${Math.round(tisMs)}ms`;
            const sortedBottlenecks = [...result.bottlenecks].sort(
              (a, b) => b.runningPct - a.runningPct,
            );
            const head = sortedBottlenecks[0];
            const bnLabel = head?.label ?? "—";
            const bnRunPct = head ? `${(head.runningPct * 100).toFixed(0)}%` : "—";
            const tiles: { label: string; value: string; hint?: string }[] = [
              { label: "Throughput", value: tput.toLocaleString(), hint: "parts / h" },
              { label: "Line efficiency", value: `${oeePct}%`, hint: "vs theoretical" },
              { label: "Completed", value: result.completed.toLocaleString(), hint: "parts" },
              { label: "Time-in-system", value: tisLabel, hint: "avg" },
              { label: "Bottleneck", value: bnLabel },
              { label: "Util on b/n", value: bnRunPct, hint: "running %" },
            ];
            return tiles.map((t) => (
              <div
                key={t.label}
                className="border-border/60 bg-background/40 flex flex-col rounded-md border px-2 py-1"
              >
                <span className="text-muted-foreground truncate text-[9px] font-medium tracking-wide uppercase">
                  {t.label}
                </span>
                <span className="text-foreground truncate font-mono text-sm font-semibold tabular-nums sm:text-base">
                  {t.value}
                </span>
                {t.hint ? (
                  <span className="text-muted-foreground truncate text-[9px]">{t.hint}</span>
                ) : null}
              </div>
            ));
          })()}
        </div>
      ) : null}
      {/* VROL-777 — persistent run console pane. Sits below the KPI strip
          (or below the toolbar when no run has fired). Collapsed by
          default; expands to a 200-line buffer with severity + clock. */}
      <div className="-mx-6 px-3 pt-1 sm:px-6">
        <RunConsole />
      </div>
      <div
        className={`grid h-[calc(100vh-15rem)] gap-3 ${
          selectedNode || selectedNodeIds.length > 1
            ? "grid-cols-[200px_1fr_260px]"
            : "grid-cols-[200px_1fr]"
        }`}
      >
        <Card className="overflow-y-auto" data-tour="palette">
          <CardHeader>
            <CardTitle className="font-heading text-base">Stations</CardTitle>
            <CardDescription>Drag onto the canvas</CardDescription>
            {/* VROL-726 — palette search. */}
            <Input
              type="search"
              value={paletteSearch}
              placeholder="Search…"
              onChange={(e) => {
                setPaletteSearch(e.target.value);
              }}
              data-testid="palette-search"
              className="h-7 text-xs"
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Sticky note — separate from PALETTE because it's not a station. */}
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/vrolen-sticky", "1");
                e.dataTransfer.effectAllowed = "move";
              }}
              className="flex cursor-grab items-center gap-2 rounded-md border border-amber-300 bg-amber-100 p-2 text-amber-900 hover:border-amber-500 active:cursor-grabbing"
              title="Free-text annotation. Press S to drop one at the cursor."
            >
              <span className="text-base" aria-hidden>
                ✎
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">Sticky note</div>
                <div className="truncate text-xs opacity-70">Annotation / comment</div>
              </div>
              {/* VROL-784 — keyboard shortcut chip. */}
              <kbd
                aria-label="Press S to insert"
                className="shrink-0 rounded bg-amber-200/60 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900"
              >
                S
              </kbd>
            </div>
            {/* Section frame — labeled, resizable container behind nodes. */}
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/vrolen-frame", "1");
                e.dataTransfer.effectAllowed = "move";
              }}
              className="border-sim-running/30 bg-sim-running/10 text-sim-running hover:border-sim-running/60 flex cursor-grab items-center gap-2 rounded-md border-2 border-dashed p-2 active:cursor-grabbing"
              title="Labeled box that groups stations visually. Press F to drop one at the cursor."
            >
              <span className="text-base" aria-hidden>
                ▢
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-foreground truncate text-sm font-medium">Section frame</div>
                <div className="text-muted-foreground truncate text-xs">Group stations</div>
              </div>
              {/* VROL-784 — keyboard shortcut chip. */}
              <kbd
                aria-label="Press F to insert"
                className="bg-sim-running/20 text-sim-running shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              >
                F
              </kbd>
            </div>
            {PALETTE.filter(
              (p) =>
                paletteSearch.trim() === "" ||
                p.label.toLowerCase().includes(paletteSearch.trim().toLowerCase()) ||
                p.summary.toLowerCase().includes(paletteSearch.trim().toLowerCase()),
            ).map((p) => (
              <div
                key={p.stationType}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/vrolen-station", p.stationType);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className="border-border bg-card hover:border-foreground/30 hover:bg-accent flex cursor-grab items-center gap-2 rounded-md border p-2 active:cursor-grabbing"
                title={`${p.summary}. Press ${p.keyHint} to insert.`}
              >
                <p.icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.label}</div>
                  <div className="text-muted-foreground truncate text-xs">{p.summary}</div>
                </div>
                {/* VROL-784 — keyboard shortcut chip. */}
                <kbd
                  aria-label={`Press ${p.keyHint} to insert`}
                  className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                >
                  {p.keyHint}
                </kbd>
              </div>
            ))}
          </CardContent>
        </Card>

        <div
          ref={wrapperRef}
          onDragOver={onDragOver}
          onDrop={onDrop}
          // VROL-784 — track cursor over the canvas so single-letter
          // station-insert shortcuts land where the user is looking.
          onMouseMove={(e) => {
            lastCanvasCursorRef.current = { clientX: e.clientX, clientY: e.clientY };
          }}
          onMouseLeave={() => {
            lastCanvasCursorRef.current = null;
          }}
          data-pan-mode={spacePanning ? "true" : undefined}
          className="border-border bg-background relative overflow-hidden rounded-md border"
        >
          <ReactFlow
            nodes={nodesForFlow}
            edges={edgesForFlowOrdered}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnectStart={onReconnectStart}
            onReconnect={onReconnect}
            onReconnectEnd={onReconnectEnd}
            onNodeContextMenu={onNodeContextMenu}
            onPaneContextMenu={onPaneContextMenu}
            onEdgeContextMenu={onEdgeContextMenu}
            onSelectionChange={onSelectionChange}
            onNodeDragStart={alignmentGuides.onNodeDragStart}
            onNodeDrag={alignmentGuides.onNodeDrag}
            onNodeDragStop={alignmentGuides.onNodeDragStop}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedNodeIds([]);
              setSelectedEdgeId(null);
            }}
            onEdgeClick={(_, edge) => {
              setSelectedEdgeId(edge.id);
              setSelectedNodeId(null);
              setSelectedNodeIds([]);
            }}
            edgesFocusable={true}
            fitView
            proOptions={{ hideAttribution: true }}
            // Generous snap radius so a drag landing within 30px of a port
            // auto-connects; ports highlight on hover via the station node's
            // Handle styles.
            connectionRadius={30}
            connectionLineStyle={{ strokeWidth: 2 }}
            // connectionMode="loose" lets the user connect target→source as
            // well as source→target (any handle to any handle). The graph
            // engine still treats the underlying direction by edge.source /
            // edge.target.
            connectionMode={ConnectionMode.Loose}
            // Every edge is reconnectable by default — drag either endpoint
            // to retarget it; drop in empty space deletes the edge. Using
            // the custom `animated` type for all edges so the hover-delete
            // × button and live playback rendering apply everywhere.
            defaultEdgeOptions={{ reconnectable: true, type: "animated" }}
            // Miro-style: drag empty space = marquee, drag node = move,
            // right/middle mouse = pan, hold Space for left-mouse pan.
            // Snap-to-grid covers everyone; the alignment-guides hook adds
            // neighbor-aware snapping on top. Multi-select uses Cmd (Mac) /
            // Ctrl (Win) — Shift is reserved for axis-lock during drag.
            snapToGrid
            snapGrid={[8, 8]}
            selectionOnDrag
            panOnDrag={[1, 2]}
            panActivationKeyCode="Space"
            multiSelectionKeyCode={["Meta", "Control"]}
            deleteKeyCode={["Backspace", "Delete"]}
            selectionKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <CanvasControls />
            <MiniMap
              pannable
              zoomable
              position="top-right"
              style={{ marginTop: 12, marginRight: 12 }}
            />
            <AlignmentGuidesOverlay guideLines={alignmentGuides.guideLines} />
            {nodesForFlow.length === 0 ? (
              <div
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
                data-testid="canvas-empty-state"
              >
                <div className="border-border bg-card/95 text-card-foreground pointer-events-auto max-w-sm rounded-lg border border-dashed px-6 py-8 text-center shadow-sm">
                  <div className="font-heading text-base font-semibold">Empty canvas</div>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Drag a station from the palette on the left to start building a line. Connect
                    them with edges to route parts through.
                  </p>
                </div>
              </div>
            ) : null}
          </ReactFlow>
          {/* VROL-819 — contextual coach overlay. Renders a single nudge at
              a time in the bottom-right of the canvas; auto-dismisses when
              its trigger flips false. */}
          <Coach
            tips={buildCoachTips(
              {
                stationCount: nodes.filter((n) => n.type === "station").length,
                edgeCount: edges.length,
                hasRun: result !== null,
                isBottleneckHigh: (() => {
                  if (!result || result.samples.length === 0) return false;
                  const idx = result.bottleneckStationIdx;
                  const last = result.samples[result.samples.length - 1];
                  const stateMs = last?.perStationStateMs[idx];
                  if (!stateMs) return false;
                  let total = 0;
                  let bad = 0;
                  for (const [k, v] of Object.entries(stateMs)) {
                    total += v;
                    if (k === "Starved" || k === "Blocked") bad += v;
                  }
                  return total > 0 && bad / total > 0.2;
                })(),
                lockedNodeCount: nodes.filter(
                  (n) => (n.data as { _locked?: boolean })._locked === true,
                ).length,
              },
              { runNow: handleRun },
            )}
          />
          {/* Live simulation playback overlay — sits above the canvas, below
              the toolbar. Hidden until a sampled run finishes. */}
          {result && playbackMs !== null && result.samples.length >= 2 ? (
            <div className="absolute right-3 bottom-3 left-3 z-10">
              <PlaybackController
                result={result}
                horizonMs={settings.horizonMs}
                playbackMs={playbackMs}
                onPlaybackChange={setPlaybackMs}
                autoPlayNonce={runNonce}
                warmupMs={Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2))}
              />
            </div>
          ) : null}
          {contextMenu ? (
            <CanvasContextMenu
              target={contextMenu}
              onClose={() => {
                setContextMenu(null);
              }}
              onDuplicate={duplicateSelection}
              onBringToFront={bringToFront}
              onSendToBack={sendToBack}
              onToggleLock={toggleLock}
              onDelete={deleteSelection}
              onPaste={pasteAtCursor}
              onSelectAll={() => {
                setNodes((ns) => ns.map((n) => ({ ...n, selected: true })));
              }}
              onFitView={() => {
                flow.fitView({ duration: 400, padding: 0.2 });
              }}
              onAutoLayout={runAutoLayout}
              onReverseEdge={() => {
                if (!contextMenu || contextMenu.kind !== "edge" || !contextMenu.edgeId) return;
                const edgeId = contextMenu.edgeId;
                setEdges((es) =>
                  es.map((e) =>
                    e.id === edgeId
                      ? {
                          ...e,
                          source: e.target,
                          target: e.source,
                          sourceHandle: e.targetHandle ?? null,
                          targetHandle: e.sourceHandle ?? null,
                        }
                      : e,
                  ),
                );
              }}
              onDeleteEdge={() => {
                if (!contextMenu || contextMenu.kind !== "edge" || !contextMenu.edgeId) return;
                const edgeId = contextMenu.edgeId;
                setEdges((es) => es.filter((e) => e.id !== edgeId));
              }}
              hasClipboard={clipboardCount > 0}
              insertItems={
                contextMenu.kind === "pane"
                  ? ([
                      ...PALETTE.map(
                        (item): ContextMenuInsertItem => ({
                          id: item.stationType,
                          label: item.label,
                          icon: item.icon,
                          run: () => {
                            insertAtClient(
                              "station",
                              contextMenu.clientX,
                              contextMenu.clientY,
                              item,
                            );
                          },
                        }),
                      ),
                      {
                        id: "sticky",
                        label: "Sticky note",
                        icon: StickyNote,
                        run: () => {
                          insertAtClient("sticky", contextMenu.clientX, contextMenu.clientY);
                        },
                      },
                      {
                        id: "frame",
                        label: "Section frame",
                        icon: FrameIcon,
                        run: () => {
                          insertAtClient("frame", contextMenu.clientX, contextMenu.clientY);
                        },
                      },
                    ] satisfies readonly ContextMenuInsertItem[])
                  : undefined
              }
            />
          ) : null}
          <AlignmentToolbar
            anchor={alignmentAnchor}
            selectedCount={nodes.filter((n) => n.selected).length}
            canDistribute={nodes.filter((n) => n.selected).length >= 3}
            onOp={onAlignmentOp}
          />
          {/* Sprint 85 — ghost quick-adds removed; users found the floating
              suggestions intrusive (appeared on every node click). Drag-
              from-handle and the station palette already cover this. */}
        </div>
        {selectedEdge ? (
          <EdgeFloatingToolbar
            anchor={edgeToolbarAnchor}
            state={
              {
                lineShape: ((selectedEdge.data as { lineShape?: EdgeLineShape } | undefined)
                  ?.lineShape ?? "smoothstep") as EdgeLineShape,
                lineDash:
                  (selectedEdge.data as { lineDash?: boolean } | undefined)?.lineDash === true,
                arrowMode: ((selectedEdge.data as { arrowMode?: EdgeArrowMode } | undefined)
                  ?.arrowMode ?? "end") as EdgeArrowMode,
                strokeColor: (selectedEdge.data as { strokeColor?: string } | undefined)
                  ?.strokeColor,
              } satisfies EdgeToolbarState
            }
            onChange={(patch) => updateSelectedEdgeData(patch)}
          />
        ) : null}
        {commandOpen ? (
          <CommandPalette
            onClose={() => {
              setCommandOpen(false);
            }}
            actions={commandActions}
          />
        ) : null}
        <InputAnalyzerModal
          open={inputAnalyzerOpen}
          onClose={() => {
            setInputAnalyzerOpen(false);
          }}
          onApply={(d) => {
            updateSelectedNodeData({ cycleDistribution: d });
            toast.success(`Distribution applied: ${d.kind}`);
          }}
        />
        {/* VROL-812 — inline name dialog for the first Cmd+S on an
            Untitled scenario. Updates the active name in place so the
            top-bar label flips without a reload. */}
        <SaveNameDialog
          open={saveNameDialogOpen}
          onOpenChange={setSaveNameDialogOpen}
          onSubmit={(name) => {
            // Reject collisions against existing scenarios just like the
            // scenarios drawer's save flow does.
            const existing = new Set(listScenarios().map((s) => s.name));
            if (existing.has(name)) {
              toast.error("That name is already taken", {
                description: "Pick a different name and try again.",
              });
              setSaveNameDialogOpen(true);
              return;
            }
            try {
              saveScenario(name, {
                graph: { nodes, edges },
                settings,
                savedAtMs: Date.now(),
              });
              setScenarios(listScenarios());
              setActiveScenarioName(name);
              setActiveScenarioSnapshot(JSON.stringify({ graph: { nodes, edges }, settings }));
              toast.success("Saved");
            } catch (err) {
              const m = err instanceof Error ? err.message : String(err);
              toast.error("Save failed", { description: m });
            }
          }}
        />

        {selectedNodeIds.length > 1 ? (
          // VROL-663 — bulk panel when 2+ stations are selected.
          <Card className="overflow-y-auto">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div className="space-y-1">
                <CardTitle className="font-heading text-base">Bulk edit</CardTitle>
                <CardDescription className="text-xs">
                  {selectedNodeIds.length} stations
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSelectedNodeIds([]);
                  setSelectedNodeId(null);
                }}
                aria-label="Close bulk inspector"
                className="-mt-1"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <BulkInspector
                selectedNodes={nodes.filter((n) => selectedNodeIds.includes(n.id))}
                onPatch={bulkPatch}
              />
            </CardContent>
          </Card>
        ) : selectedNode && (selectedNode.type === "sticky" || selectedNode.type === "frame") ? (
          <NonStationInspector
            node={selectedNode}
            onClose={() => {
              setSelectedNodeId(null);
            }}
            onPatch={updateSelectedNodeData}
            scenarioName={activeScenarioName}
          />
        ) : selectedNode ? (
          <Card className="overflow-y-auto">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div className="space-y-1">
                <CardTitle className="font-heading text-base">Inspector</CardTitle>
                {/* VROL-729 — breadcrumb: scenario › station label · station type. */}
                <CardDescription className="text-xs">
                  <span className="text-foreground/70">{activeScenarioName ?? "Untitled"}</span>
                  <span className="mx-1">›</span>
                  <span className="font-medium">
                    {(selectedNode.data as { label?: string }).label ?? selectedNode.id}
                  </span>
                  <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                    {(selectedNode.data as { stationType?: string }).stationType ?? ""}
                  </span>
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSelectedNodeId(null);
                }}
                aria-label="Close inspector"
                className="-mt-1"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            {/* VROL-773 — tabbed inspector: Basics / Schedule / Recipe & cost.
                Replaces the VROL-669 anchor strip + the long vertical accordion
                stack. Per-tab error dots aggregate validation issues whose
                `path` ends in one of INSPECTOR_TAB_FIELDS[tab]. */}
            {(() => {
              const allIssues = [...validation.errors, ...validation.warnings];
              const tabIssues: Record<InspectorTab, readonly ValidationIssue[]> = {
                basics: INSPECTOR_TAB_FIELDS.basics.flatMap((f) =>
                  findIssuesForField(allIssues, selectedNode.id, f),
                ),
                schedule: INSPECTOR_TAB_FIELDS.schedule.flatMap((f) =>
                  findIssuesForField(allIssues, selectedNode.id, f),
                ),
                "recipe-cost": INSPECTOR_TAB_FIELDS["recipe-cost"].flatMap((f) =>
                  findIssuesForField(allIssues, selectedNode.id, f),
                ),
              };
              const onTabKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
                // VROL-773 — explicit ArrowLeft / ArrowRight wiring. base-ui's
                // Tabs primitive supplies its own roving-tabindex behaviour but
                // we hard-wire the spec'd contract here so the test can drive it
                // without depending on the primitive's internals.
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const idx = INSPECTOR_TAB_ORDER.indexOf(inspectorTab);
                if (idx === -1) return;
                const delta = e.key === "ArrowRight" ? 1 : -1;
                const next =
                  INSPECTOR_TAB_ORDER[
                    (idx + delta + INSPECTOR_TAB_ORDER.length) % INSPECTOR_TAB_ORDER.length
                  ];
                if (next) setInspectorTab(next);
              };
              return (
                <Tabs
                  value={inspectorTab}
                  onValueChange={(v) => {
                    if (v === "basics" || v === "schedule" || v === "recipe-cost") {
                      setInspectorTab(v);
                    }
                  }}
                  className="gap-0"
                >
                  {/* Mobile: tabs collapse into a native select. The Tabs root
                      still owns state so the panels render correctly. */}
                  <div className="border-border border-b px-3 pb-2 sm:hidden">
                    <label htmlFor="inspector-tab-select" className="sr-only">
                      Inspector section
                    </label>
                    <select
                      id="inspector-tab-select"
                      data-testid="inspector-tab-select"
                      value={inspectorTab}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "basics" || v === "schedule" || v === "recipe-cost") {
                          setInspectorTab(v);
                        }
                      }}
                      className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
                    >
                      {INSPECTOR_TAB_ORDER.map((tab) => {
                        const hasError = tabIssues[tab].length > 0;
                        return (
                          <option key={tab} value={tab}>
                            {INSPECTOR_TAB_LABEL[tab]}
                            {hasError ? " •" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <TabsList
                    variant="line"
                    className="border-border hidden h-9 w-full justify-start gap-0 rounded-none border-b px-3 sm:flex"
                    data-testid="inspector-tabs"
                  >
                    {INSPECTOR_TAB_ORDER.map((tab) => {
                      const issues = tabIssues[tab];
                      return (
                        <TabsTrigger
                          key={tab}
                          value={tab}
                          onKeyDown={onTabKeyDown}
                          data-testid={`inspector-tab-${tab}`}
                          className="flex-none px-3"
                        >
                          <span>{INSPECTOR_TAB_LABEL[tab]}</span>
                          {issues.length > 0 ? (
                            <span
                              data-testid={`inspector-tab-dot-${tab}`}
                              className={`ml-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                                issues.some((i) => i.severity === "error")
                                  ? "bg-sim-down"
                                  : "bg-sim-setup"
                              }`}
                              aria-label={
                                issues.some((i) => i.severity === "error")
                                  ? "Validation error"
                                  : "Validation warning"
                              }
                            />
                          ) : null}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                  <TabsContent value="basics">
                    <CardContent className="space-y-3" data-testid="inspector-panel-basics">
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="inspector-label"
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Label
                        </label>
                        <Input
                          id="inspector-label"
                          type="text"
                          value={String((selectedNode.data as { label?: unknown }).label ?? "")}
                          onChange={(e) => {
                            updateSelectedNodeData({ label: e.target.value });
                          }}
                        />
                      </div>
                      <DistributionField
                        label="Cycle distribution"
                        id="inspector-dist-kind"
                        value={
                          ((selectedNode.data as { cycleDistribution?: Distribution })
                            .cycleDistribution ??
                            constant(
                              Number((selectedNode.data as { cycleMs?: unknown }).cycleMs ?? 100),
                            )) as Distribution
                        }
                        onChange={(d) => {
                          updateSelectedNodeData({ cycleDistribution: d });
                        }}
                      />
                      <div className="-mt-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setInputAnalyzerOpen(true);
                          }}
                          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline"
                          title="Open the Input Analyzer to fit a distribution to measured cycle times"
                        >
                          🧪 Fit from real data…
                        </button>
                      </div>
                      {/* VROL-744 — show this station's cycle vs line median when a run exists. */}
                      {result && runMeta
                        ? (() => {
                            const stationIdx = runMeta.chainNodeIds.indexOf(selectedNode.id);
                            if (stationIdx === -1) return null;
                            const ownCycle =
                              result.perStationOee[stationIdx]?.idealCycleTimeMs ?? 0;
                            if (ownCycle === 0) return null;
                            const cs = cycleStats(result);
                            const pct =
                              cs.medianMs > 0 ? Math.round((ownCycle / cs.medianMs) * 100) : 100;
                            const tone =
                              pct >= 150
                                ? "text-sim-down-foreground"
                                : pct >= 110
                                  ? "text-sim-setup-foreground"
                                  : "text-muted-foreground";
                            return (
                              <div className={`text-xs ${tone}`}>
                                Cycle: {Math.round(ownCycle)} ms · {String(pct)}% of line median (
                                {Math.round(cs.medianMs)} ms)
                              </div>
                            );
                          })()
                        : null}
                      {/* VROL-899 — OEM-rated nominal max. When set, Performance
                          drops below 100% to reflect subordination — running
                          this machine below its rated speed to pace a slower
                          downstream or to extend MTBF. Field is optional;
                          legacy stations leave it blank and behaviour is
                          unchanged. */}
                      <NumberField
                        id="inspector-nominal-cycle"
                        label="Nominal max (ms)"
                        value={Number(
                          (selectedNode.data as { nominalCycleTimeMs?: unknown })
                            .nominalCycleTimeMs ?? 0,
                        )}
                        min={0}
                        max={60_000}
                        step={1}
                        helperText="OEM-rated design max cycle time. Leave 0/blank when operating == nominal. Performance drops below 100% when the operating cycle is slower than nominal."
                        inputClassName="font-mono tabular-nums w-32"
                        onChange={(n) => {
                          updateSelectedNodeData({
                            nominalCycleTimeMs: n > 0 ? n : undefined,
                          });
                        }}
                      />
                      {/* VROL-901 — surface the operating vs nominal speed
                          ratio when a run exists, so the user gets an immediate
                          read on whether this station is subordinated or
                          at-max. Mirrors what the canvas chip shows. */}
                      {result && runMeta
                        ? (() => {
                            const ratio = result.bottlenecks.find(
                              (b) => b.stationId === selectedNode.id,
                            )?.nominalSpeedRatio;
                            if (typeof ratio !== "number" || ratio >= 0.999) return null;
                            return (
                              <div className="text-muted-foreground text-xs">
                                Running at{" "}
                                <span className="font-mono tabular-nums">
                                  {Math.round(ratio * 100)}%
                                </span>{" "}
                                of nominal — subordinated to the bottleneck.
                              </div>
                            );
                          })()
                        : null}
                      <NumberField
                        id="inspector-defect"
                        label="Defect rate"
                        labelSuffix={
                          <FieldErrorIndicator
                            issues={findIssuesForField(allIssues, selectedNode.id, "defectRate")}
                          />
                        }
                        value={Number(
                          (selectedNode.data as { defectRate?: unknown }).defectRate ?? 0,
                        )}
                        min={0}
                        max={1}
                        step={0.01}
                        helperText="Probability that a finished part is defective (0–1). Raises scrap rate; drops line efficiency × Quality. Each defect cascades to scrap or rework."
                        inputClassName="font-mono tabular-nums w-32"
                        onChange={(n) => {
                          updateSelectedNodeData({ defectRate: n });
                        }}
                      />
                      <NumberField
                        id="inspector-capacity"
                        label="Parallel cycles"
                        labelSuffix={
                          <FieldErrorIndicator
                            issues={findIssuesForField(allIssues, selectedNode.id, "capacity")}
                          />
                        }
                        value={Number((selectedNode.data as { capacity?: unknown }).capacity ?? 1)}
                        min={1}
                        max={10}
                        step={1}
                        helperText="Number of parts this station processes simultaneously. Lifts throughput linearly when this is the bottleneck. Default 1."
                        onChange={(n) => {
                          const v = Math.max(1, Math.min(10, Math.floor(n)));
                          updateSelectedNodeData({ capacity: v === 1 ? undefined : v });
                        }}
                      />
                      <SetupTimeEditor
                        value={
                          (selectedNode.data as { setupDistribution?: Distribution })
                            .setupDistribution ?? null
                        }
                        onChange={(d) => {
                          updateSelectedNodeData({ setupDistribution: d ?? undefined });
                        }}
                      />
                      {/* VROL-662 — CustomStation description. Only shown when
                          the station is a "custom" type. Lives in Basics
                          because it explains what the station represents. */}
                      {(selectedNode.data as { stationType?: string }).stationType === "custom" ? (
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor="inspector-custom-description"
                            className="text-muted-foreground text-xs font-medium"
                          >
                            What does this represent?
                          </label>
                          <textarea
                            id="inspector-custom-description"
                            rows={2}
                            placeholder="e.g. Decanter, Mixing tank, Drying oven"
                            value={
                              (selectedNode.data as { customDescription?: string })
                                .customDescription ?? ""
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              updateSelectedNodeData({
                                customDescription: v.length > 0 ? v : undefined,
                              });
                            }}
                            className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
                          />
                        </div>
                      ) : null}
                      {/* VROL-281 — Description + Tags fill out the "all standard
                          fields" set for the station property panel. */}
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="inspector-description"
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Description
                        </label>
                        <textarea
                          id="inspector-description"
                          rows={2}
                          placeholder="Notes for this station…"
                          className="border-border bg-background focus-visible:ring-ring/40 block w-full resize-y rounded-md border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
                          value={String(
                            (selectedNode.data as { description?: unknown }).description ?? "",
                          )}
                          onChange={(e) => {
                            const value = e.target.value;
                            updateSelectedNodeData({
                              description: value.trim() === "" ? undefined : value,
                            });
                          }}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor="inspector-tags"
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Tags
                        </label>
                        <Input
                          id="inspector-tags"
                          type="text"
                          placeholder="comma,separated,tags"
                          value={(() => {
                            const t = (selectedNode.data as { tags?: unknown }).tags;
                            return Array.isArray(t) ? t.join(", ") : "";
                          })()}
                          onChange={(e) => {
                            const next = e.target.value
                              .split(",")
                              .map((s) => s.trim())
                              .filter((s) => s.length > 0);
                            updateSelectedNodeData({
                              tags: next.length === 0 ? undefined : next,
                            });
                          }}
                        />
                      </div>
                    </CardContent>
                  </TabsContent>
                  <TabsContent value="schedule">
                    <CardContent className="space-y-3" data-testid="inspector-panel-schedule">
                      <MaintenanceWindowsEditor
                        value={
                          Array.isArray(
                            (selectedNode.data as { maintenanceWindows?: unknown })
                              .maintenanceWindows,
                          )
                            ? ((
                                selectedNode.data as {
                                  maintenanceWindows: { startMs: number; endMs: number }[];
                                }
                              ).maintenanceWindows ?? [])
                            : []
                        }
                        onChange={(next) => {
                          updateSelectedNodeData({ maintenanceWindows: next });
                        }}
                      />
                      <div className="flex flex-col gap-1">
                        {(() => {
                          const skillIssues = findIssuesForField(
                            allIssues,
                            selectedNode.id,
                            "skills",
                          );
                          return skillIssues.length > 0 ? (
                            <div className="flex items-center gap-1.5">
                              <FieldErrorIndicator issues={skillIssues} />
                              <span className="text-muted-foreground text-[11px]">
                                {skillIssues[0]?.message}
                              </span>
                            </div>
                          ) : null;
                        })()}
                        <SkillsField
                          value={
                            Array.isArray((selectedNode.data as { skills?: unknown }).skills)
                              ? ((selectedNode.data as { skills: string[] }).skills as string[])
                              : []
                          }
                          onChange={(next) => {
                            updateSelectedNodeData({ skills: next });
                          }}
                          label="Required skills"
                          placeholder="e.g. capping, qc"
                          id="inspector-skills"
                          helpText="Empty = any worker on shift can take the station."
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="inspector-rework"
                          className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium"
                        >
                          Rework target
                          <FieldErrorIndicator
                            issues={findIssuesForField(
                              allIssues,
                              selectedNode.id,
                              "reworkTargetNodeId",
                            )}
                          />
                        </label>
                        <select
                          id="inspector-rework"
                          value={
                            (selectedNode.data as { reworkTargetNodeId?: string })
                              .reworkTargetNodeId ?? ""
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            updateSelectedNodeData({
                              reworkTargetNodeId: v.length > 0 ? v : undefined,
                            });
                          }}
                          className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
                        >
                          <option value="">None — scrap defects</option>
                          {nodes
                            .filter((n) => n.id !== selectedNode.id)
                            .map((n) => {
                              const d = n.data as { label?: string };
                              return (
                                <option key={n.id} value={n.id}>
                                  {d.label ?? n.id}
                                </option>
                              );
                            })}
                        </select>
                        <p className="text-muted-foreground text-[11px]">
                          Where defects route for another pass.
                        </p>
                      </div>
                      {(selectedNode.data as { reworkTargetNodeId?: string }).reworkTargetNodeId ? (
                        <NumberField
                          id="inspector-rework-pass-limit"
                          label="Max rework passes"
                          labelSuffix={
                            <FieldErrorIndicator
                              issues={findIssuesForField(
                                allIssues,
                                selectedNode.id,
                                "reworkPassLimit",
                              )}
                            />
                          }
                          value={
                            (selectedNode.data as { reworkPassLimit?: number }).reworkPassLimit ?? 3
                          }
                          min={1}
                          max={10}
                          step={1}
                          helperText="After this many passes, defects scrap. Default 3."
                          onChange={(n) => {
                            const v = Math.floor(n);
                            updateSelectedNodeData({
                              reworkPassLimit: v === 3 ? undefined : v,
                            });
                          }}
                        />
                      ) : null}
                      {/* VROL-286 — customParams editor. Lives in Schedule
                          because most custom params are time-related. */}
                      <CustomParamsField
                        value={
                          ((selectedNode.data as { customParams?: readonly CustomParam[] })
                            .customParams ?? []) as readonly CustomParam[]
                        }
                        onChange={(next) => {
                          updateSelectedNodeData({
                            customParams: next.length > 0 ? next : undefined,
                          });
                        }}
                      />
                    </CardContent>
                  </TabsContent>
                  <TabsContent value="recipe-cost">
                    <CardContent className="space-y-3" data-testid="inspector-panel-recipe-cost">
                      {settings.products.enabled && settings.products.list.length > 0 ? (
                        <PerProductCyclesEditor
                          products={settings.products.list}
                          value={
                            (selectedNode.data as { cycleByProduct?: Record<string, Distribution> })
                              .cycleByProduct ?? {}
                          }
                          onChange={(next) => {
                            updateSelectedNodeData({
                              cycleByProduct: Object.keys(next).length > 0 ? next : undefined,
                            });
                          }}
                        />
                      ) : null}
                      {/* VROL-293 — Recipe editor section. Visible when materials
                          are enabled. The recipe applies to the station that's
                          selected when Run fires. */}
                      {settings.materials.enabled ? (
                        <div className="flex flex-col gap-1.5">
                          <div className="text-muted-foreground text-xs font-medium">Recipe</div>
                          <div className="grid grid-cols-2 gap-2">
                            <NumberField
                              id="inspector-recipe-bottles"
                              label="Bottles / part"
                              value={settings.materials.bottlesPerPart}
                              min={0}
                              step={1}
                              onChange={(n) => {
                                setSettings((s) => ({
                                  ...s,
                                  materials: { ...s.materials, bottlesPerPart: Math.max(0, n) },
                                }));
                              }}
                            />
                            <NumberField
                              id="inspector-recipe-caps"
                              label="Caps / part"
                              value={settings.materials.capsPerPart}
                              min={0}
                              step={1}
                              onChange={(n) => {
                                setSettings((s) => ({
                                  ...s,
                                  materials: { ...s.materials, capsPerPart: Math.max(0, n) },
                                }));
                              }}
                            />
                          </div>
                          <p className="text-muted-foreground text-[11px]">
                            Applied to whichever station is selected when Run fires. Set a qty to 0
                            to drop that material from the recipe.
                          </p>
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                          Cost & revenue
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <NumberField
                            id="inspector-cost-hour"
                            label="$ / hour"
                            value={Number(
                              (selectedNode.data as { costPerHour?: unknown }).costPerHour ?? 0,
                            )}
                            min={0}
                            step={1}
                            inputClassName="font-mono tabular-nums"
                            onChange={(n) => {
                              updateSelectedNodeData({ costPerHour: n });
                            }}
                          />
                          <NumberField
                            id="inspector-cost-cycle"
                            label="$ / cycle"
                            value={Number(
                              (selectedNode.data as { costPerCycle?: unknown }).costPerCycle ?? 0,
                            )}
                            min={0}
                            step={0.001}
                            inputClassName="font-mono tabular-nums"
                            onChange={(n) => {
                              updateSelectedNodeData({ costPerCycle: n });
                            }}
                          />
                          <NumberField
                            id="inspector-cost-scrap"
                            label="$ / scrap"
                            value={Number(
                              (selectedNode.data as { costPerScrap?: unknown }).costPerScrap ?? 0,
                            )}
                            min={0}
                            step={0.01}
                            inputClassName="font-mono tabular-nums"
                            onChange={(n) => {
                              updateSelectedNodeData({ costPerScrap: n });
                            }}
                          />
                          <NumberField
                            id="inspector-revenue"
                            label="$ / good part"
                            value={Number(
                              (selectedNode.data as { revenuePerPart?: unknown }).revenuePerPart ??
                                0,
                            )}
                            min={0}
                            step={0.01}
                            inputClassName="font-mono tabular-nums"
                            onChange={(n) => {
                              updateSelectedNodeData({ revenuePerPart: n });
                            }}
                          />
                        </div>
                        <p className="text-muted-foreground text-[11px]">
                          Set $/h on machines, $/cycle on consumable stations, $/scrap on QC, and
                          $/good part on the output sink. The Cost &amp; revenue card unlocks after
                          the next Run.
                        </p>
                      </div>
                    </CardContent>
                  </TabsContent>
                </Tabs>
              );
            })()}
          </Card>
        ) : null}
      </div>

      {result && runMeta ? (
        <Suspense
          fallback={
            <div className="space-y-3" aria-label="Loading results">
              {/* VROL-725 — richer skeleton mirroring the actual result layout. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="border-border bg-muted/40 h-20 animate-pulse rounded-md border p-3"
                  />
                ))}
              </div>
              <div className="border-border bg-muted/30 h-24 animate-pulse rounded-md border" />
              <div className="border-border bg-muted/30 h-40 animate-pulse rounded-md border" />
            </div>
          }
        >
          <ResultPanel
            result={result}
            runMeta={runMeta}
            horizonMs={settings.horizonMs}
            warmupMs={Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2))}
            // VROL-690 — pan + zoom canvas to a station by chain-order index.
            onFocusStation={(stationIdx) => {
              if (!runMeta) return;
              const nodeId = runMeta.chainNodeIds[stationIdx];
              if (!nodeId) return;
              const node = nodes.find((n) => n.id === nodeId);
              if (!node) return;
              flow.setCenter(node.position.x + 75, node.position.y + 40, {
                zoom: 1.2,
                duration: 400,
              });
              setSelectedNodeId(nodeId);
            }}
            onApplyWarmup={(ms) => {
              setSettings((s) => ({ ...s, warmupMs: ms }));
              setTimeout(() => {
                if (!isRunning) handleRun();
              }, 0);
            }}
            replicationSummary={replicationSummary}
            replicationBaseline={baselineSummary}
            sensitivitySummary={sensitivitySummary}
            sensitivityRunning={sensitivityRunning}
            onRunSensitivity={handleSensitivitySweep}
            wipCurveSummary={wipCurveSummary}
            wipCurveRunning={wipCurveRunning}
            onRunWipCurve={handleWipCurveScan}
            onApplyWipCapacity={(capacity) => {
              setSettings((s) => ({ ...s, interStationBufferCapacity: capacity }));
              setTimeout(() => {
                if (!isRunning) handleRun();
              }, 0);
            }}
            optimizationSummary={optimizationSummary}
            optimizationRunning={optimizationRunning}
            onRunOptimization={handleOptimizationSearch}
            onApplyOptimization={handleApplyOptimization}
            costSummary={
              runMeta
                ? summarizeCosts(
                    result,
                    settings.horizonMs,
                    runMeta.chainNodeIds,
                    runMeta.stationLabels,
                    nodes,
                  )
                : null
            }
            // VROL-902 — pass MTTR + per-edge buffer capacities so the
            // Recommendations card can surface tightly-coupled warnings.
            // settings.breakdowns is only meaningful when .enabled is true;
            // wrap mttrMs in a constant distribution to match the engine.
            {...(settings.breakdowns.enabled
              ? {
                  mttrDistribution: constant(Math.max(1, settings.breakdowns.mttrMs)),
                }
              : {})}
            bufferEdges={edges.map((e) => {
              const src = nodes.find((n) => n.id === e.source);
              const tgt = nodes.find((n) => n.id === e.target);
              const srcLabel = (src?.data as { label?: unknown } | undefined)?.label;
              const tgtLabel = (tgt?.data as { label?: unknown } | undefined)?.label;
              const label =
                typeof srcLabel === "string" && typeof tgtLabel === "string"
                  ? `${srcLabel} → ${tgtLabel}`
                  : undefined;
              return {
                edgeId: e.id,
                capacity: settings.interStationBufferCapacity,
                ...(label !== undefined ? { label } : {}),
              };
            })}
          />
        </Suspense>
      ) : null}

      <Sheet
        open={comparison !== null}
        onOpenChange={(open) => {
          if (!open) setComparison(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-[28rem] flex-col gap-0 overflow-y-auto sm:max-w-lg"
        >
          <SheetHeader className="space-y-1 pr-10">
            <SheetTitle>Comparison</SheetTitle>
            <SheetDescription>
              Both scenarios were run with their own settings. Deltas are{" "}
              <span className="font-medium">B − A</span> (current canvas vs saved scenario).
            </SheetDescription>
            {/* Flip + JSON export sit under the title so they can't collide
                with the shadcn close (X) button. */}
            {comparison ? (
              <div className="flex gap-1 pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // VROL-713 — flip A and B sides; persisted preference so users
                    // who consistently want canvas-as-A see it that way next time.
                    if (typeof window !== "undefined") {
                      const v = window.localStorage?.getItem?.("vrolen.compare-flip") ?? "0";
                      window.localStorage?.setItem?.("vrolen.compare-flip", v === "1" ? "0" : "1");
                    }
                    setComparison((c) =>
                      c
                        ? {
                            aName: c.bName,
                            aResult: c.bResult,
                            aStationLabels: c.bStationLabels,
                            bName: c.aName,
                            bResult: c.aResult,
                            bStationLabels: c.aStationLabels,
                            horizonMs: c.horizonMs,
                            warmupMs: c.warmupMs,
                          }
                        : null,
                    );
                  }}
                >
                  Flip A↔B
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // VROL-668 — export comparison as JSON.
                    const payload = {
                      savedAtMs: Date.now(),
                      horizonMs: comparison.horizonMs,
                      warmupMs: comparison.warmupMs,
                      a: {
                        name: comparison.aName,
                        stationLabels: comparison.aStationLabels,
                        result: JSON.parse(chainResultToJsonString(comparison.aResult)) as unknown,
                      },
                      b: {
                        name: comparison.bName,
                        stationLabels: comparison.bStationLabels,
                        result: JSON.parse(chainResultToJsonString(comparison.bResult)) as unknown,
                      },
                    };
                    const stem = suggestedFilenameStem(
                      `${comparison.aName}-vs-${comparison.bName}`,
                    );
                    downloadFile(
                      `${stem}-compare.json`,
                      JSON.stringify(payload, null, 2),
                      "application/json",
                    );
                  }}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  JSON
                </Button>
              </div>
            ) : null}
          </SheetHeader>
          {comparison ? (
            <div className="space-y-4 px-4 pb-6">
              <Suspense
                fallback={
                  <div
                    className="bg-muted h-32 animate-pulse rounded-md"
                    aria-label="Loading comparison"
                  />
                }
              >
                <ComparisonTable
                  aName={comparison.aName}
                  aResult={comparison.aResult}
                  aStationLabels={comparison.aStationLabels}
                  bName={comparison.bName}
                  bResult={comparison.bResult}
                  bStationLabels={comparison.bStationLabels}
                  horizonMs={comparison.horizonMs}
                  warmupMs={comparison.warmupMs}
                />
              </Suspense>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={scenariosOpen} onOpenChange={setScenariosOpen}>
        <SheetContent
          side="right"
          className="flex w-[24rem] flex-col gap-0 overflow-y-auto sm:max-w-md"
        >
          <SheetHeader className="space-y-1 pr-10">
            <SheetTitle>Scenarios</SheetTitle>
            <SheetDescription>
              Save and restore named scenarios. Persisted locally in your browser.
            </SheetDescription>
            {/* JSON bundle export + import. Placed under the title so they
                can't collide with the shadcn close (X) button. */}
            <div className="flex gap-1 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                aria-label="Export scenarios as JSON bundle"
                onClick={() => {
                  const bundle = buildBundle(Date.now());
                  downloadFile(
                    `vrolen-scenarios-${String(Date.now())}.json`,
                    stringifyBundle(bundle),
                    "application/json",
                  );
                  toast.success("Exported scenarios", {
                    description: `${String(bundle.scenarios.length)} bundled`,
                  });
                }}
              >
                <Download className="h-3 w-3" /> Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1"
                aria-label="Import scenarios from JSON bundle"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.accept = "application/json,.json";
                  input.onchange = () => {
                    const file = input.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      try {
                        const text = String(reader.result);
                        const parsed = JSON.parse(text) as unknown;
                        if (!isBundle(parsed)) {
                          toast.error("Not a vrolen scenario bundle");
                          return;
                        }
                        const names = new Set(parsed.scenarios.map((s) => s.name));
                        // VROL-759 — confirm before overwriting existing scenarios; switch to
                        // skip policy when the user declines so duplicates land as no-ops.
                        const existing = new Set(listScenarios().map((s) => s.name));
                        const overlap = [...names].filter((n) => existing.has(n));
                        const policy =
                          overlap.length === 0 ||
                          window.confirm(
                            `${String(overlap.length)} scenario${overlap.length === 1 ? "" : "s"} already exist (${overlap.join(", ")}). Overwrite?`,
                          )
                            ? "overwrite"
                            : "skip";
                        const summary = importBundle(parsed, names, policy);
                        setScenarios(listScenarios());
                        toast.success("Imported scenarios", {
                          description: `${String(summary.imported)} imported · ${String(summary.skipped)} skipped (policy: ${policy})`,
                        });
                      } catch (err) {
                        const m = err instanceof Error ? err.message : String(err);
                        toast.error("Couldn't import bundle", { description: m });
                      }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
              >
                Import
              </Button>
            </div>
          </SheetHeader>
          {savedComparisons.length > 0 ? (
            <div className="space-y-2 px-4 pt-2">
              <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Saved comparisons
              </div>
              <ul className="space-y-1">
                {savedComparisons.map((c) => (
                  <li
                    key={c.id}
                    className="border-border bg-card flex items-center gap-2 rounded-md border p-2 text-xs"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      title={`${c.aName} vs ${c.bName}`}
                      onClick={() => {
                        restoreComparison(c);
                        setScenariosOpen(false);
                      }}
                    >
                      <span className="font-medium">{c.aName}</span>{" "}
                      <span className="text-muted-foreground">vs</span>{" "}
                      <span className="font-medium">{c.bName}</span>
                    </button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remove saved comparison ${c.id}`}
                      onClick={() => {
                        deleteSavedComparison(c.id);
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="space-y-4 px-4 pb-6">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = saveNameDraft.trim();
                if (!name) {
                  toast.error("Scenario name required");
                  return;
                }
                try {
                  saveScenario(name, {
                    graph: { nodes, edges },
                    settings,
                    savedAtMs: performance.now(),
                  });
                  setScenarios(listScenarios());
                  setSaveNameDraft("");
                  // Saving the current canvas under `name` makes that scenario
                  // the active one + resets the modified snapshot.
                  setActiveScenarioName(name);
                  setActiveScenarioSnapshot(JSON.stringify({ graph: { nodes, edges }, settings }));
                  toast.success(`Saved "${name}"`);
                } catch (err) {
                  const message = err instanceof Error ? err.message : String(err);
                  toast.error("Couldn't save scenario", { description: message });
                }
              }}
            >
              <div className="flex flex-1 flex-col gap-1">
                <label htmlFor="rs-save-name" className="text-muted-foreground text-xs font-medium">
                  Save current as
                </label>
                <Input
                  id="rs-save-name"
                  type="text"
                  value={saveNameDraft}
                  placeholder="e.g. diamond-demo"
                  onChange={(e) => {
                    setSaveNameDraft(e.target.value);
                  }}
                />
              </div>
              <Button type="submit" size="sm" className="gap-2">
                <Save className="h-4 w-4" />
                Save
              </Button>
            </form>
            {/* VROL-630 — Examples (preset scenarios) above the user's saved list. */}
            <div className="border-border space-y-2 rounded-md border border-dashed p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Examples</div>
                <span className="text-muted-foreground text-[10px]">
                  {PRESETS.length} preset{PRESETS.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                Pre-built scenarios that exercise distinct engine features. Loading replaces the
                canvas + run settings with the preset's editable copy.
              </p>
              <ul className="space-y-1.5">
                {PRESETS.map((preset) => (
                  <li
                    key={preset.id}
                    className="bg-card border-border flex items-start gap-2 rounded-md border px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{preset.title}</div>
                      <div className="text-muted-foreground text-[11px]">{preset.highlight}</div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        loadPresetInto(preset);
                      }}
                    >
                      Load
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
            {/* VROL-674 — recent runs across every scenario, newest-first. */}
            {recentRuns.length > 0 ? (
              <div
                className="border-border space-y-2 rounded-md border p-3"
                data-testid="recent-runs-panel"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Recent runs</div>
                  <span className="text-muted-foreground text-[10px]">
                    last {recentRuns.length}
                  </span>
                </div>
                <ul className="space-y-1">
                  {recentRuns.map((r, i) => {
                    const tPerHr = Math.round(r.throughputLambda * 3_600_000);
                    const slot = historyCompareA === i ? "A" : historyCompareB === i ? "B" : null;
                    return (
                      <li
                        key={`${r.scenarioName}-${String(r.runAtMs)}-${String(i)}`}
                        className="bg-card border-border flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {slot ? (
                            <span className="bg-sim-running text-sim-running-foreground mr-1 rounded px-1 font-mono">
                              {slot}
                            </span>
                          ) : null}
                          {r.scenarioName}
                        </span>
                        <span
                          className="text-muted-foreground font-mono tabular-nums"
                          title={`${r.completed.toLocaleString()} completed · efficiency ${(r.lineOee * 100).toFixed(0)}%${r.bottleneckLabel ? ` · bottleneck ${r.bottleneckLabel}` : ""}`}
                        >
                          {tPerHr.toLocaleString()}/hr
                        </span>
                        {/* VROL-715 — replay this exact entry. */}
                        {r.payload ? (
                          <button
                            type="button"
                            aria-label={`Replay ${r.scenarioName}`}
                            title="Load this run's snapshot into the canvas"
                            onClick={() => {
                              if (!r.payload) return;
                              setNodes([...r.payload.graph.nodes]);
                              setEdges([...r.payload.graph.edges]);
                              setSettings(r.payload.settings);
                              setScenariosOpen(false);
                              toast.success(`Replayed ${r.scenarioName}`);
                            }}
                            className="border-border hover:bg-muted shrink-0 rounded border px-1 text-[10px]"
                          >
                            ▶
                          </button>
                        ) : null}
                        {/* VROL-682 — pick A or B to set up a history-vs-history compare. */}
                        {r.payload ? (
                          <div className="flex shrink-0 gap-1">
                            <button
                              type="button"
                              aria-label={historyCompareA === i ? "Unpick A" : "Pick as A"}
                              onClick={() => {
                                setHistoryCompareA(historyCompareA === i ? null : i);
                              }}
                              className={`rounded border px-1.5 font-mono ${
                                historyCompareA === i
                                  ? "bg-sim-running text-sim-running-foreground border-sim-running"
                                  : "border-border hover:bg-muted"
                              }`}
                            >
                              A
                            </button>
                            <button
                              type="button"
                              aria-label={historyCompareB === i ? "Unpick B" : "Pick as B"}
                              onClick={() => {
                                setHistoryCompareB(historyCompareB === i ? null : i);
                              }}
                              className={`rounded border px-1.5 font-mono ${
                                historyCompareB === i
                                  ? "bg-sim-running text-sim-running-foreground border-sim-running"
                                  : "border-border hover:bg-muted"
                              }`}
                            >
                              B
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {historyCompareA !== null && historyCompareB !== null ? (
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const aEntry = recentRuns[historyCompareA];
                      const bEntry = recentRuns[historyCompareB];
                      if (!aEntry?.payload || !bEntry?.payload) {
                        toast.error("Picked runs lack a replay payload");
                        return;
                      }
                      const aOutcome = runScenario(
                        aEntry.payload.graph.nodes,
                        aEntry.payload.graph.edges,
                        aEntry.payload.settings,
                        null,
                      );
                      const bOutcome = runScenario(
                        bEntry.payload.graph.nodes,
                        bEntry.payload.graph.edges,
                        bEntry.payload.settings,
                        null,
                      );
                      if (!("result" in aOutcome) || !("result" in bOutcome)) {
                        toast.error("Couldn't run one of the picked entries");
                        return;
                      }
                      const horizonMs = Math.max(
                        aEntry.payload.settings.horizonMs,
                        bEntry.payload.settings.horizonMs,
                      );
                      const warmupMs = Math.min(
                        aEntry.payload.settings.warmupMs,
                        bEntry.payload.settings.warmupMs,
                        Math.floor(horizonMs / 2),
                      );
                      setComparison({
                        aName: `${aEntry.scenarioName} (history)`,
                        aResult: aOutcome.result,
                        aStationLabels: aOutcome.runMeta.stationLabels,
                        bName: `${bEntry.scenarioName} (history)`,
                        bResult: bOutcome.result,
                        bStationLabels: bOutcome.runMeta.stationLabels,
                        horizonMs,
                        warmupMs,
                      });
                      setScenariosOpen(false);
                      setHistoryCompareA(null);
                      setHistoryCompareB(null);
                    }}
                  >
                    Compare A vs B
                  </Button>
                ) : null}
              </div>
            ) : null}
            {/* VROL-789 — 2 last-used primary buttons + collapsed "More scenarios…"
                + search across the FULL list. Recency comes from scenario-store's
                lastUsedAtMs (bumped on load + save). The render-prop carries
                every per-row affordance the editor needs (notes, history,
                confirm). */}
            <ScenariosList
              scenarios={scenarios}
              activeScenarioName={activeScenarioName}
              onPrimaryLoad={(name) => {
                setConfirmAction({ scenario: name, kind: "load" });
              }}
              renderItem={(s) => {
                const history = historyByScenario[s.name] ?? [];
                return (
                  <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {s.name}
                          {activeScenarioName === s.name ? (
                            <span
                              className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                                activeScenarioIsModified
                                  ? "bg-sim-setup text-sim-setup-foreground"
                                  : "bg-sim-running text-sim-running-foreground"
                              }`}
                            >
                              {activeScenarioIsModified ? "active · modified" : "active"}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-muted-foreground text-xs">
                          {s.nodeCount} node{s.nodeCount === 1 ? "" : "s"} · {s.edgeCount} edge
                          {s.edgeCount === 1 ? "" : "s"}
                          {/* VROL-700 — last-run throughput chip for at-a-glance comparison. */}
                          {history[0] ? (
                            <span
                              className="text-foreground/80 ml-2 font-mono tabular-nums"
                              title={`Last run: ${history[0].completed.toLocaleString()} parts · efficiency ${(history[0].lineOee * 100).toFixed(0)}%`}
                            >
                              ·{" "}
                              {Math.round(history[0].throughputLambda * 3_600_000).toLocaleString()}
                              /h
                            </span>
                          ) : null}
                        </div>
                        {/* VROL-714 — bottleneck migration trail (oldest → newest). */}
                        {history.some((h) => h.bottleneckLabel) ? (
                          <div className="text-muted-foreground mt-1 flex flex-wrap gap-1 text-[10px]">
                            <span className="text-[9px] tracking-wide uppercase">Bottlenecks:</span>
                            {[...history]
                              .reverse()
                              .filter((h) => h.bottleneckLabel)
                              .map((h, hi) => (
                                <span
                                  key={String(h.runAtMs) + String(hi)}
                                  className="bg-muted rounded px-1.5 py-0.5 font-mono text-[9px]"
                                >
                                  {h.bottleneckLabel}
                                </span>
                              ))}
                          </div>
                        ) : null}
                        {/* VROL-691 — scenario notes inline editor. */}
                        <textarea
                          aria-label={`Notes for ${s.name}`}
                          placeholder="Add notes…"
                          className="border-border bg-background focus-visible:ring-ring/40 mt-1.5 block w-full resize-y rounded-md border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
                          rows={2}
                          value={notesDraft[s.name] ?? s.notes ?? ""}
                          onChange={(e) => {
                            setNotesDraft((d) => ({ ...d, [s.name]: e.target.value }));
                          }}
                          onBlur={(e) => {
                            const next = e.target.value;
                            if (next === (s.notes ?? "")) return;
                            if (setScenarioNotes(s.name, next)) {
                              setScenarios(listScenarios());
                            }
                          }}
                        />
                      </div>
                      <div className="flex gap-1">
                        {confirmAction && confirmAction.scenario === s.name ? (
                          <div
                            ref={(el) => {
                              confirmTargetRef.current = el;
                            }}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="text-muted-foreground">
                              {/* VROL-751 — phrase confirm by current dirty state. */}
                              {confirmAction.kind === "load"
                                ? activeScenarioIsModified
                                  ? `Discard ${
                                      activeScenarioDiff
                                        ? `${String(
                                            activeScenarioDiff.nodeChanges +
                                              activeScenarioDiff.edgeChanges +
                                              activeScenarioDiff.settingsChanges,
                                          )} change${
                                            activeScenarioDiff.nodeChanges +
                                              activeScenarioDiff.edgeChanges +
                                              activeScenarioDiff.settingsChanges ===
                                            1
                                              ? ""
                                              : "s"
                                          }`
                                        : "your changes"
                                    } and load?`
                                  : "Load? Unsaved canvas lost."
                                : confirmAction.kind === "load-run"
                                  ? "Load + Run? Unsaved canvas lost."
                                  : "Delete?"}
                            </span>
                            <Button
                              size="sm"
                              onClick={() => {
                                const action = confirmAction;
                                setConfirmAction(null);
                                if (action.kind === "delete") {
                                  deleteScenario(s.name);
                                  setScenarios(listScenarios());
                                  setHistoryByScenario((prev) => {
                                    const next = { ...prev };
                                    delete next[s.name];
                                    return next;
                                  });
                                  if (activeScenarioName === s.name) setActiveScenarioName(null);
                                  toast.info(`Deleted "${s.name}"`);
                                } else if (action.kind === "load") {
                                  loadScenarioInto(s.name);
                                } else if (action.kind === "load-run") {
                                  if (loadScenarioInto(s.name)) {
                                    setTimeout(() => {
                                      handleRun();
                                    }, 0);
                                  }
                                }
                              }}
                            >
                              Yes
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setConfirmAction(null);
                              }}
                            >
                              No
                            </Button>
                          </div>
                        ) : (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setConfirmAction({ scenario: s.name, kind: "load" });
                              }}
                            >
                              Load
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setConfirmAction({ scenario: s.name, kind: "load-run" });
                              }}
                            >
                              Load + Run
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                handleCompare(s.name);
                              }}
                            >
                              Compare
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                // VROL-665 — duplicate. Find a unique "name (copy)"
                                // name; increment suffix if it already exists.
                                const src = loadScenario(s.name);
                                if (!src) {
                                  toast.error(`Couldn't read "${s.name}"`);
                                  return;
                                }
                                const existing = new Set(listScenarios().map((q) => q.name));
                                let candidate = `${s.name} (copy)`;
                                let n = 2;
                                while (existing.has(candidate)) {
                                  candidate = `${s.name} (copy ${String(n)})`;
                                  n += 1;
                                }
                                saveScenario(candidate, {
                                  graph: src.graph,
                                  settings: src.settings,
                                });
                                setScenarios(listScenarios());
                                toast.success(`Duplicated to "${candidate}"`);
                              }}
                              aria-label={`Duplicate ${s.name}`}
                            >
                              Duplicate
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${s.name}`}
                              onClick={() => {
                                setConfirmAction({ scenario: s.name, kind: "delete" });
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    {history.length > 0 ? (
                      <details className="border-border border-t pt-2 text-xs">
                        <summary className="text-muted-foreground cursor-pointer">
                          {history.length} recent run{history.length === 1 ? "" : "s"}
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {history.map((h, idx) => {
                            const canReplay = !!h.payload;
                            const isConfirming =
                              confirmReplay !== null &&
                              confirmReplay.scenario === s.name &&
                              confirmReplay.idx === idx;
                            return (
                              <li
                                key={`${String(h.runAtMs)}-${String(idx)}`}
                                className="text-muted-foreground flex items-center justify-between gap-2"
                              >
                                <span className="font-mono tabular-nums">
                                  {new Date(h.runAtMs).toLocaleString()}
                                </span>
                                <span className="flex items-center gap-2">
                                  <span>
                                    {h.completed.toLocaleString()} parts ·{" "}
                                    {(h.lineOee * 100).toFixed(1)}% efficiency
                                  </span>
                                  {isConfirming ? (
                                    <span
                                      ref={(el) => {
                                        confirmTargetRef.current = el;
                                      }}
                                      className="flex items-center gap-1"
                                    >
                                      <span className="text-muted-foreground">
                                        Replay? Unsaved canvas lost.
                                      </span>
                                      <Button
                                        size="sm"
                                        onClick={() => {
                                          const p = h.payload;
                                          setConfirmReplay(null);
                                          if (!p) return;
                                          setNodes(ensureStationKeys([...p.graph.nodes]));
                                          setEdges([...p.graph.edges]);
                                          setSettings(p.settings);
                                          setSelectedNodeId(null);
                                          setResult(null);
                                          setRunMeta(null);
                                          toast.success("Replayed canvas + settings");
                                        }}
                                      >
                                        Yes
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setConfirmReplay(null);
                                        }}
                                      >
                                        No
                                      </Button>
                                    </span>
                                  ) : (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={!canReplay}
                                      title={
                                        canReplay
                                          ? "Restore canvas + settings from this run"
                                          : "Run too old — no snapshot was captured"
                                      }
                                      onClick={() => {
                                        setConfirmReplay({ scenario: s.name, idx });
                                      }}
                                    >
                                      Replay
                                    </Button>
                                  )}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                );
              }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent
          side="right"
          className="flex w-[24rem] flex-col gap-0 overflow-y-auto sm:max-w-md"
        >
          <SheetHeader className="space-y-1 pr-10">
            <SheetTitle>Run settings</SheetTitle>
            <SheetDescription>Applied to every Run. Persisted across reloads.</SheetDescription>
            {/* VROL-712 — copy / paste settings JSON. Placed under the title
                so they can't collide with the shadcn close (X) button. */}
            <div className="flex gap-1 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  try {
                    void navigator.clipboard?.writeText(JSON.stringify(settings, null, 2));
                    toast.success("Settings copied as JSON");
                  } catch {
                    toast.error("Copy failed");
                  }
                }}
              >
                Copy
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard?.readText();
                    if (!text) {
                      toast.error("Clipboard is empty");
                      return;
                    }
                    const parsed = JSON.parse(text) as unknown;
                    if (!parsed || typeof parsed !== "object") {
                      toast.error("Not a settings object");
                      return;
                    }
                    setSettings({ ...DEFAULT_RUN_SETTINGS, ...(parsed as RunSettings) });
                    toast.success("Settings pasted from clipboard");
                  } catch (err) {
                    const m = err instanceof Error ? err.message : String(err);
                    toast.error("Paste failed", { description: m });
                  }
                }}
              >
                Paste
              </Button>
            </div>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6">
            {/* VROL-633 — at-a-glance status strip so the user sees which
                optional features are active without scrolling through five
                collapsed sections. */}
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span
                className={`rounded-full px-2 py-0.5 ${
                  settings.samplerIntervalMs > 0
                    ? "bg-sim-running/15 text-sim-running"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Sampler: {settings.samplerIntervalMs > 0 ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ${
                  settings.materials.enabled
                    ? "bg-sim-running/15 text-sim-running"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Materials: {settings.materials.enabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ${
                  settings.breakdowns.enabled
                    ? "bg-sim-running/15 text-sim-running"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Breakdowns: {settings.breakdowns.enabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ${
                  settings.workers.enabled
                    ? "bg-sim-running/15 text-sim-running"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Workers: {settings.workers.enabled ? "on" : "off"}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 ${
                  settings.products.enabled
                    ? "bg-sim-running/15 text-sim-running"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                Products: {settings.products.enabled ? "on" : "off"}
              </span>
            </div>
            <section className="space-y-3">
              <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                Engine
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* VROL-822 — unit-aware horizon. User picks ms / s / min /
                    h via the inline unit Select; canonical value stays in
                    ms underneath. Quick-pick chips still apply absolute
                    ms values so 1h / 8h / 24h / 1w are correct regardless
                    of the chosen display unit. */}
                <div className="flex flex-col gap-1">
                  <DurationInput
                    id="rs-horizon"
                    label="Horizon"
                    valueMs={settings.horizonMs}
                    min={1000}
                    defaultUnit="min"
                    onChangeMs={(ms) => {
                      setSettings((s) => ({ ...s, horizonMs: Math.floor(ms) }));
                    }}
                  />
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: "1h", ms: 3_600_000 },
                      { label: "8h", ms: 8 * 3_600_000 },
                      { label: "24h", ms: 24 * 3_600_000 },
                      { label: "1w", ms: 7 * 24 * 3_600_000 },
                    ].map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setSettings((s) => ({ ...s, horizonMs: p.ms }));
                        }}
                        className={`border-border hover:bg-muted rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
                          settings.horizonMs === p.ms ? "bg-muted text-foreground" : ""
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <DurationInput
                  id="rs-warmup"
                  label="Warm-up"
                  valueMs={settings.warmupMs}
                  min={0}
                  defaultUnit="s"
                  onChangeMs={(ms) => {
                    setSettings((s) => ({ ...s, warmupMs: Math.floor(ms) }));
                  }}
                />
                <NumberField
                  id="rs-buf"
                  label="Buffer capacity"
                  value={settings.interStationBufferCapacity}
                  min={1}
                  onChange={(n) => {
                    setSettings((s) => ({
                      ...s,
                      interStationBufferCapacity: Math.floor(n),
                    }));
                  }}
                />
              </div>
              {/* VROL-892 — replace the raw Replications NumberField with
                  a Quick / Reliable / Custom pill toggle. Non-technical
                  users get a domain-friendly question ("how confident?")
                  rather than a math knob. */}
              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-muted-foreground mb-1 text-xs font-medium">
                  How confident do you want the result to be?
                </legend>
                <div role="radiogroup" aria-label="Confidence" className="flex flex-wrap gap-1.5">
                  {[
                    { id: "quick", label: "Quick (1 run)", reps: 1 },
                    { id: "reliable", label: "Reliable (30 runs)", reps: 30 },
                  ].map((opt) => {
                    const active = settings.replications === opt.reps;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setSettings((s) => ({ ...s, replications: opt.reps }));
                        }}
                        className={`border-border rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                          active
                            ? "bg-sim-running/15 text-sim-running border-sim-running/30"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <details className="text-muted-foreground -ml-1 text-[11px]">
                  <summary className="hover:text-foreground cursor-pointer rounded px-1 py-0.5">
                    Custom number of runs
                  </summary>
                  <div className="mt-1.5 pl-1">
                    <NumberField
                      id="rs-reps"
                      label=""
                      value={settings.replications}
                      min={1}
                      max={50}
                      onChange={(n) => {
                        setSettings((s) => ({
                          ...s,
                          replications: Math.max(1, Math.min(50, Math.floor(n))),
                        }));
                      }}
                    />
                  </div>
                </details>
                <p className="text-muted-foreground text-[11px]">
                  {settings.replications === 1
                    ? "One simulation run. Fast but doesn't tell you whether the result is robust or lucky."
                    : `${String(settings.replications)} simulation runs averaged. Result panel adds 95% confidence intervals; canvas + playback show the first run.`}
                </p>
              </fieldset>
              {/* VROL-892 — the raw Seed integer moves behind an Advanced
                  disclosure. Each run is reproducible without any user
                  action; researchers can still grab/set the exact seed
                  from here. */}
              <details className="border-border bg-background/40 rounded-md border p-2 text-xs">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer font-medium">
                  Advanced (researchers only)
                </summary>
                <div className="mt-2 space-y-2">
                  <p className="text-muted-foreground text-[11px]">
                    The random seed controls every stochastic decision in the engine — same seed,
                    same numbers. Each scenario gets a fresh seed automatically. Use the toolbar
                    "Try another draw" to roll a new one without opening this section.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <label
                        htmlFor="rs-seed"
                        className="text-muted-foreground text-[11px] font-medium"
                      >
                        Random seed
                      </label>
                      <Input
                        id="rs-seed"
                        type="number"
                        min={0}
                        value={settings.seed}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n)) {
                            setSettings((s) => ({ ...s, seed: Math.floor(n) }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      className="mt-4 gap-1"
                      onClick={() => {
                        const next = Math.floor(Math.random() * 1_000_000);
                        setSettings((s) => ({ ...s, seed: next }));
                      }}
                    >
                      <Sparkles className="h-3 w-3" />
                      Regenerate
                    </Button>
                  </div>
                </div>
              </details>
              <div className="border-border space-y-1 rounded-md border border-dashed p-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="checkbox"
                    checked={settings.samplerIntervalMs > 0}
                    onChange={(e) => {
                      setSettings((s) => ({
                        ...s,
                        samplerIntervalMs: e.target.checked ? 1_000 : 0,
                      }));
                    }}
                  />
                  Sample throughput over time
                </label>
                <p className="text-muted-foreground text-xs">
                  Powers charts + sparklines.
                  {/* VROL-755 — explicit prompt when sampler is off. */}
                  {settings.samplerIntervalMs === 0 ? (
                    <span className="text-sim-setup-foreground ml-1">
                      Sampler is off — buffer + state-over-time charts will be empty.
                    </span>
                  ) : null}
                </p>
                {settings.samplerIntervalMs > 0 ? (
                  <div className="flex items-center gap-2 text-xs">
                    <label htmlFor="rs-sampler" className="text-muted-foreground font-medium">
                      Every
                    </label>
                    <Input
                      id="rs-sampler"
                      type="number"
                      min={50}
                      step={50}
                      value={settings.samplerIntervalMs}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n > 0) {
                          setSettings((s) => ({
                            ...s,
                            samplerIntervalMs: Math.max(50, Math.floor(n)),
                          }));
                        }
                      }}
                      className="w-24 font-mono tabular-nums"
                    />
                    <span className="text-muted-foreground">ms</span>
                  </div>
                ) : null}
                {/* VROL-753 — warn when interval is too fine vs horizon (too many samples). */}
                {settings.samplerIntervalMs > 0 &&
                settings.horizonMs / settings.samplerIntervalMs > 5000 ? (
                  <p className="text-sim-down-foreground text-xs">
                    ~{String(Math.round(settings.horizonMs / settings.samplerIntervalMs))} samples —
                    consider raising the interval, the chart will be hard to read and the run will
                    be slow.
                  </p>
                ) : null}
                {/* VROL-753 — also warn when interval > horizon/10 (you'll get a flat chart). */}
                {settings.samplerIntervalMs > 0 &&
                settings.samplerIntervalMs > settings.horizonMs / 10 ? (
                  <p className="text-sim-setup-foreground text-xs">
                    Only ~{String(Math.round(settings.horizonMs / settings.samplerIntervalMs))}{" "}
                    samples — chart will be coarse. Try a smaller interval.
                  </p>
                ) : null}
              </div>
            </section>

            {/* VROL-651 — finite-rate source generation */}
            <Accordion
              title="Source rate"
              icon={<Hourglass className="h-4 w-4" />}
              status={
                <AccordionStatus tone={settings.source.enabled ? "on" : "off"}>
                  {settings.source.enabled
                    ? `On · every ${String(Math.round(settings.source.intervalMs / 60_000))}m`
                    : "Off"}
                </AccordionStatus>
              }
              expanded={drawerSections.source}
              onToggle={() => {
                toggleDrawerSection("source");
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.source.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSettings((s) => ({ ...s, source: { ...s.source, enabled } }));
                  }}
                  className="accent-sim-running h-4 w-4"
                />
                Throttle the source to a fixed inter-arrival rate
              </label>
              {settings.source.enabled ? (
                <>
                  <p className="text-muted-foreground text-xs">
                    Models periodic part arrivals — pallets, batches, conveyor beats. When off, the
                    source produces as fast as its cycle allows.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NumberField
                      id="rs-src-interval"
                      label="Inter-arrival (minutes)"
                      value={Math.round(settings.source.intervalMs / 60_000)}
                      min={1}
                      step={1}
                      onChange={(n) => {
                        const minutes = Math.max(1, Math.floor(n));
                        setSettings((s) => ({
                          ...s,
                          source: { ...s.source, intervalMs: minutes * 60_000 },
                        }));
                      }}
                    />
                    <NumberField
                      id="rs-src-batch"
                      label="Batch size"
                      value={settings.source.batchSize}
                      min={1}
                      max={1000}
                      step={1}
                      helperText="Parts pushed per arrival event. Default 1."
                      onChange={(n) => {
                        const batchSize = Math.max(1, Math.floor(n));
                        setSettings((s) => ({ ...s, source: { ...s.source, batchSize } }));
                      }}
                    />
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    {`Fires ~${String(
                      Math.floor(settings.horizonMs / Math.max(1, settings.source.intervalMs)) + 1,
                    )} time${
                      Math.floor(settings.horizonMs / Math.max(1, settings.source.intervalMs)) +
                        1 ===
                      1
                        ? ""
                        : "s"
                    } during the horizon · ${String(
                      (Math.floor(settings.horizonMs / Math.max(1, settings.source.intervalMs)) +
                        1) *
                        settings.source.batchSize,
                    )} parts total.`}
                  </p>
                </>
              ) : null}
            </Accordion>

            <Accordion
              title="Materials"
              icon={<Package className="h-4 w-4" />}
              status={
                <AccordionStatus tone={settings.materials.enabled ? "on" : "off"}>
                  {settings.materials.enabled ? "On" : "Off"}
                </AccordionStatus>
              }
              expanded={drawerSections.materials}
              onToggle={() => {
                toggleDrawerSection("materials");
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.materials.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSettings((s) => ({
                      ...s,
                      materials: { ...s.materials, enabled },
                    }));
                  }}
                  className="accent-sim-running h-4 w-4"
                />
                Enable bottle + cap consumption per part
              </label>
              {settings.materials.enabled ? (
                <>
                  <p className="text-muted-foreground text-xs">
                    Applied to the selected node{" "}
                    {selectedNodeId ? (
                      <strong className="text-foreground">({String(selectedNodeId)})</strong>
                    ) : (
                      <em>(select one first)</em>
                    )}
                    .
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="rs-bottles"
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Starting bottles
                      </label>
                      <Input
                        id="rs-bottles"
                        type="number"
                        min={0}
                        value={settings.materials.bottles}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 0) {
                            setSettings((s) => ({
                              ...s,
                              materials: { ...s.materials, bottles: Math.floor(n) },
                            }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="rs-caps"
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Starting caps
                      </label>
                      <Input
                        id="rs-caps"
                        type="number"
                        min={0}
                        value={settings.materials.caps}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 0) {
                            setSettings((s) => ({
                              ...s,
                              materials: { ...s.materials, caps: Math.floor(n) },
                            }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      checked={settings.materials.replenishment.enabled}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        setSettings((s) => ({
                          ...s,
                          materials: {
                            ...s.materials,
                            replenishment: { ...s.materials.replenishment, enabled },
                          },
                        }));
                      }}
                      className="accent-sim-running h-4 w-4"
                    />
                    Schedule a single bottle replenishment
                  </label>
                  {settings.materials.replenishment.enabled ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <NumberField
                        id="rs-rep-at"
                        label="Replenish at (ms)"
                        min={0}
                        step={1000}
                        value={settings.materials.replenishment.atMs}
                        onChange={(n) => {
                          setSettings((s) => ({
                            ...s,
                            materials: {
                              ...s.materials,
                              replenishment: {
                                ...s.materials.replenishment,
                                atMs: Math.floor(n),
                              },
                            },
                          }));
                        }}
                      />
                      <NumberField
                        id="rs-rep-amt"
                        label="Bottles delivered"
                        min={1}
                        value={settings.materials.replenishment.amount}
                        onChange={(n) => {
                          setSettings((s) => ({
                            ...s,
                            materials: {
                              ...s.materials,
                              replenishment: {
                                ...s.materials.replenishment,
                                amount: Math.max(1, Math.floor(n)),
                              },
                            },
                          }));
                        }}
                      />
                    </div>
                  ) : null}
                  {/* VROL-643 — recurring / finite-rate deliveries */}
                  <div className="border-border space-y-2 rounded-md border border-dashed p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Recurring deliveries</span>
                      <button
                        type="button"
                        className="border-input bg-background hover:bg-muted rounded-md border px-2 py-1 text-xs"
                        onClick={() => {
                          setSettings((s) => ({
                            ...s,
                            materials: {
                              ...s.materials,
                              recurring: [
                                ...s.materials.recurring,
                                { material: "bottles", amount: 100, intervalMs: 5 * 60_000 },
                              ],
                            },
                          }));
                        }}
                      >
                        + Add delivery
                      </button>
                    </div>
                    {settings.materials.recurring.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        Periodic resupply — every N minutes, add a fixed quantity. Optional cap
                        keeps the pool bounded.
                      </p>
                    ) : (
                      <ul className="space-y-2">
                        {settings.materials.recurring.map((r, idx) => {
                          const fires =
                            r.intervalMs > 0
                              ? Math.floor(settings.horizonMs / r.intervalMs) + 1
                              : 0;
                          return (
                            <li
                              key={`rec-${String(idx)}`}
                              className="border-border bg-card space-y-2 rounded-md border p-2"
                            >
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div className="flex flex-col gap-1">
                                  <label
                                    htmlFor={`rs-rec-mat-${String(idx)}`}
                                    className="text-muted-foreground text-xs font-medium"
                                  >
                                    Material
                                  </label>
                                  <select
                                    id={`rs-rec-mat-${String(idx)}`}
                                    value={r.material}
                                    onChange={(e) => {
                                      const m =
                                        e.target.value === "caps"
                                          ? ("caps" as const)
                                          : ("bottles" as const);
                                      setSettings((s) => ({
                                        ...s,
                                        materials: {
                                          ...s.materials,
                                          recurring: s.materials.recurring.map((row, i) =>
                                            i === idx ? { ...row, material: m } : row,
                                          ),
                                        },
                                      }));
                                    }}
                                    className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
                                  >
                                    <option value="bottles">Bottles</option>
                                    <option value="caps">Caps</option>
                                  </select>
                                </div>
                                <NumberField
                                  id={`rs-rec-amt-${String(idx)}`}
                                  label="Amount per delivery"
                                  value={r.amount}
                                  min={0}
                                  onChange={(n) => {
                                    setSettings((s) => ({
                                      ...s,
                                      materials: {
                                        ...s.materials,
                                        recurring: s.materials.recurring.map((row, i) =>
                                          i === idx ? { ...row, amount: Math.floor(n) } : row,
                                        ),
                                      },
                                    }));
                                  }}
                                />
                                <NumberField
                                  id={`rs-rec-int-${String(idx)}`}
                                  label="Every (minutes)"
                                  value={Math.round(r.intervalMs / 60_000)}
                                  min={1}
                                  onChange={(n) => {
                                    setSettings((s) => ({
                                      ...s,
                                      materials: {
                                        ...s.materials,
                                        recurring: s.materials.recurring.map((row, i) =>
                                          i === idx
                                            ? {
                                                ...row,
                                                intervalMs: Math.max(1, Math.floor(n)) * 60_000,
                                              }
                                            : row,
                                        ),
                                      },
                                    }));
                                  }}
                                />
                                <NumberField
                                  id={`rs-rec-cap-${String(idx)}`}
                                  label="Cap (optional, 0 = none)"
                                  value={r.maxInventory ?? 0}
                                  min={0}
                                  onChange={(n) => {
                                    const v = Math.floor(n);
                                    setSettings((s) => ({
                                      ...s,
                                      materials: {
                                        ...s.materials,
                                        recurring: s.materials.recurring.map((row, i) => {
                                          if (i !== idx) return row;
                                          if (v <= 0) {
                                            const { material, amount, intervalMs } = row;
                                            return { material, amount, intervalMs };
                                          }
                                          return { ...row, maxInventory: v };
                                        }),
                                      },
                                    }));
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-muted-foreground text-[11px]">
                                  Fires ~{String(fires)} time{fires === 1 ? "" : "s"} during the
                                  horizon.
                                </span>
                                <button
                                  type="button"
                                  className="text-destructive hover:text-destructive/80 text-xs"
                                  onClick={() => {
                                    setSettings((s) => ({
                                      ...s,
                                      materials: {
                                        ...s.materials,
                                        recurring: s.materials.recurring.filter(
                                          (_, i) => i !== idx,
                                        ),
                                      },
                                    }));
                                  }}
                                >
                                  Remove
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              ) : null}
            </Accordion>

            <Accordion
              title="Multi-product mix"
              icon={<Boxes className="h-4 w-4" />}
              status={
                <AccordionStatus tone={settings.products.enabled ? "on" : "off"}>
                  {settings.products.enabled
                    ? `On · ${String(settings.products.list.length)} product${
                        settings.products.list.length === 1 ? "" : "s"
                      }`
                    : "Off"}
                </AccordionStatus>
              }
              expanded={drawerSections.products}
              onToggle={() => {
                toggleDrawerSection("products");
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.products.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSettings((s) => ({
                      ...s,
                      products: { ...s.products, enabled },
                    }));
                  }}
                  className="accent-sim-running h-4 w-4"
                />
                Enable multi-product mix at source
              </label>
              {settings.products.enabled ? (
                <div className="space-y-2">
                  {settings.products.list.map((p, idx) => {
                    const totalWeight = settings.products.list.reduce(
                      (s, q) => s + Math.max(0, q.weight),
                      0,
                    );
                    const sharePct = totalWeight > 0 ? (p.weight / totalWeight) * 100 : 0;
                    return (
                      <div
                        key={idx}
                        className="border-border grid grid-cols-[1fr_1fr_80px_auto] items-end gap-2 rounded-md border p-2"
                      >
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`rs-product-${String(idx)}-id`}
                            className="text-muted-foreground text-xs font-medium"
                          >
                            ID
                          </label>
                          <Input
                            id={`rs-product-${String(idx)}-id`}
                            type="text"
                            value={p.id}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSettings((s) => ({
                                ...s,
                                products: {
                                  ...s.products,
                                  list: s.products.list.map((q, i) =>
                                    i === idx ? { ...q, id: v } : q,
                                  ),
                                },
                              }));
                            }}
                            className="font-mono text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`rs-product-${String(idx)}-name`}
                            className="text-muted-foreground text-xs font-medium"
                          >
                            Name
                          </label>
                          <Input
                            id={`rs-product-${String(idx)}-name`}
                            type="text"
                            value={p.name}
                            onChange={(e) => {
                              const v = e.target.value;
                              setSettings((s) => ({
                                ...s,
                                products: {
                                  ...s.products,
                                  list: s.products.list.map((q, i) =>
                                    i === idx ? { ...q, name: v } : q,
                                  ),
                                },
                              }));
                            }}
                            className="text-sm"
                          />
                        </div>
                        <div className="flex flex-col gap-1">
                          <label
                            htmlFor={`rs-product-${String(idx)}-weight`}
                            className="text-muted-foreground text-xs font-medium"
                          >
                            Weight ({sharePct.toFixed(0)}%)
                          </label>
                          <Input
                            id={`rs-product-${String(idx)}-weight`}
                            type="number"
                            min={1}
                            value={p.weight}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n) && n >= 0) {
                                setSettings((s) => ({
                                  ...s,
                                  products: {
                                    ...s.products,
                                    list: s.products.list.map((q, i) =>
                                      i === idx ? { ...q, weight: n } : q,
                                    ),
                                  },
                                }));
                              }
                            }}
                            className="font-mono tabular-nums"
                          />
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove product ${p.name}`}
                          disabled={settings.products.list.length <= 1}
                          onClick={() => {
                            setSettings((s) => ({
                              ...s,
                              products: {
                                ...s.products,
                                list: s.products.list.filter((_, i) => i !== idx),
                              },
                            }));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const nextLetter = String.fromCharCode(65 + settings.products.list.length);
                      setSettings((s) => ({
                        ...s,
                        products: {
                          ...s.products,
                          list: [
                            ...s.products.list,
                            { id: nextLetter, name: `Product ${nextLetter}`, weight: 10 },
                          ],
                        },
                      }));
                    }}
                  >
                    Add product
                  </Button>

                  {/* VROL-664 — production plan editor */}
                  <div className="border-border space-y-2 rounded-md border border-dashed p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Production plan (FIFO)</span>
                      <button
                        type="button"
                        className="border-input bg-background hover:bg-muted rounded-md border px-2 py-1 text-xs"
                        onClick={() => {
                          const firstId = settings.products.list[0]?.id ?? "A";
                          setSettings((s) => ({
                            ...s,
                            products: {
                              ...s.products,
                              productionPlan: [
                                ...(s.products.productionPlan ?? []),
                                { productId: firstId, quantity: 10 },
                              ],
                            },
                          }));
                        }}
                      >
                        + Add row
                      </button>
                    </div>
                    {(settings.products.productionPlan ?? []).length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        Optional. When set, the engine emits parts in this exact order then drains.
                        Overrides the weighted mix above.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {(settings.products.productionPlan ?? []).map((row, idx) => (
                          <li
                            key={`plan-${String(idx)}`}
                            className="border-border bg-card flex items-center gap-1.5 rounded-md border p-1.5"
                          >
                            <span className="text-muted-foreground w-5 font-mono text-[10px]">
                              {String(idx + 1)}.
                            </span>
                            <select
                              value={row.productId}
                              onChange={(e) => {
                                const v = e.target.value;
                                setSettings((s) => ({
                                  ...s,
                                  products: {
                                    ...s.products,
                                    productionPlan: (s.products.productionPlan ?? []).map((p, i) =>
                                      i === idx ? { ...p, productId: v } : p,
                                    ),
                                  },
                                }));
                              }}
                              className="border-input bg-background h-7 flex-1 rounded-md border px-2 text-xs"
                              aria-label={`Product for plan row ${String(idx + 1)}`}
                            >
                              {settings.products.list.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} ({p.id})
                                </option>
                              ))}
                            </select>
                            <Input
                              type="number"
                              min={1}
                              value={row.quantity}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n) || n < 1) return;
                                setSettings((s) => ({
                                  ...s,
                                  products: {
                                    ...s.products,
                                    productionPlan: (s.products.productionPlan ?? []).map((p, i) =>
                                      i === idx ? { ...p, quantity: Math.floor(n) } : p,
                                    ),
                                  },
                                }));
                              }}
                              aria-label={`Qty for plan row ${String(idx + 1)}`}
                              className="h-7 w-20 font-mono text-xs"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                setSettings((s) => ({
                                  ...s,
                                  products: {
                                    ...s.products,
                                    productionPlan: (s.products.productionPlan ?? []).filter(
                                      (_, i) => i !== idx,
                                    ),
                                  },
                                }));
                              }}
                              className="text-muted-foreground hover:text-destructive p-0.5"
                              aria-label={`Remove plan row ${String(idx + 1)}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : null}
            </Accordion>

            <Accordion
              title="Workers"
              icon={<CircleDot className="h-4 w-4" />}
              status={
                <AccordionStatus tone={settings.workers.enabled ? "on" : "off"}>
                  {settings.workers.enabled
                    ? `On · ${String(settings.workers.list.length)} worker${
                        settings.workers.list.length === 1 ? "" : "s"
                      }`
                    : "Off"}
                </AccordionStatus>
              }
              expanded={drawerSections.workers}
              onToggle={() => {
                toggleDrawerSection("workers");
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.workers.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSettings((s) => ({
                      ...s,
                      workers: { ...s.workers, enabled },
                    }));
                  }}
                  className="accent-sim-running h-4 w-4"
                />
                Require 1 worker per station
              </label>
              {settings.workers.enabled ? (
                <div className="space-y-3">
                  {settings.workers.list.map((entry, idx) => (
                    <div key={idx} className="border-border space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Input
                          type="text"
                          value={entry.name}
                          onChange={(e) => {
                            const v = e.target.value;
                            setSettings((s) => ({
                              ...s,
                              workers: {
                                ...s.workers,
                                list: s.workers.list.map((w, i) =>
                                  i === idx ? { ...w, name: v } : w,
                                ),
                              },
                            }));
                          }}
                          placeholder={`Worker ${String(idx + 1)}`}
                          className="text-sm"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove worker ${String(idx + 1)}`}
                          disabled={settings.workers.list.length <= 1}
                          onClick={() => {
                            setSettings((s) => ({
                              ...s,
                              workers: {
                                ...s.workers,
                                list: s.workers.list.filter((_, i) => i !== idx),
                              },
                            }));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <SkillsField
                        value={entry.skills}
                        onChange={(next) => {
                          setSettings((s) => ({
                            ...s,
                            workers: {
                              ...s.workers,
                              list: s.workers.list.map((w, i) =>
                                i === idx ? { ...w, skills: next.length > 0 ? next : ["any"] } : w,
                              ),
                            },
                          }));
                        }}
                        label="Skills"
                        placeholder="e.g. capping, qc, any"
                        id={`rs-worker-${String(idx)}-skills`}
                      />
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor={`rs-worker-${String(idx)}-shift`}
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Shift end (ms)
                        </label>
                        <Input
                          id={`rs-worker-${String(idx)}-shift`}
                          type="number"
                          min={1000}
                          step={1000}
                          value={entry.shiftEndMs}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n > 0) {
                              setSettings((s) => ({
                                ...s,
                                workers: {
                                  ...s.workers,
                                  list: s.workers.list.map((w, i) =>
                                    i === idx ? { ...w, shiftEndMs: Math.floor(n) } : w,
                                  ),
                                },
                              }));
                            }
                          }}
                          className="font-mono tabular-nums"
                        />
                      </div>
                      <BreaksEditor
                        workerIdx={idx}
                        breaks={entry.breaks ?? []}
                        shiftEndMs={entry.shiftEndMs}
                        onChange={(nextBreaks) => {
                          setSettings((s) => ({
                            ...s,
                            workers: {
                              ...s.workers,
                              list: s.workers.list.map((w, i) => {
                                if (i !== idx) return w;
                                if (nextBreaks.length === 0) {
                                  const { breaks: _omit, ...rest } = w;
                                  void _omit;
                                  return rest;
                                }
                                return { ...w, breaks: nextBreaks };
                              }),
                            },
                          }));
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => {
                      setSettings((s) => ({
                        ...s,
                        workers: {
                          ...s.workers,
                          list: [
                            ...s.workers.list,
                            {
                              name: `Worker ${String(s.workers.list.length + 1)}`,
                              skills: ["any"],
                              shiftEndMs: 60_000,
                            },
                          ],
                        },
                      }));
                    }}
                  >
                    Add worker
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    {settings.workers.list.length >= 3
                      ? "≥3 workers — no labor bottleneck on a 3-station chain."
                      : settings.workers.list.length === 1
                        ? "Single worker — chain is rate-limited by labor."
                        : `${String(settings.workers.list.length)} workers — partial labor contention.`}
                  </p>
                  {/* VROL-301 — skill coverage chips so the user can see which
                      skills the pool covers without expanding every worker. */}
                  {(() => {
                    const counts = new Map<string, number>();
                    for (const w of settings.workers.list) {
                      for (const s of w.skills) {
                        counts.set(s, (counts.get(s) ?? 0) + 1);
                      }
                    }
                    if (counts.size === 0) return null;
                    return (
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        {[...counts.entries()]
                          .sort((a, b) => b[1] - a[1])
                          .map(([skill, n]) => (
                            <span
                              key={skill}
                              className="bg-muted text-foreground rounded-full px-1.5 py-0.5 font-mono"
                            >
                              {skill}
                              {n > 1 ? ` × ${String(n)}` : ""}
                            </span>
                          ))}
                      </div>
                    );
                  })()}
                </div>
              ) : null}
            </Accordion>

            {/* VROL-297 — Line-wide schedule editor REMOVED in VROL-AUDIT (data-flow audit).
                The accordion wrote to settings.schedule.breaks / settings.schedule.maintenanceWindows
                but NO run path read them — EditorPage.handleRun and runScenario both ignored
                the field, so users got identical results with or without the schedule enabled.
                Fix 5 path (b) per the audit: remove the UI rather than wire it up. Follow-up:
                re-introduce as a properly-wired feature that fans out to per-station
                maintenance windows + worker breaks (or applies natively in the engine). */}

            <Accordion
              title="Breakdowns"
              icon={<Zap className="h-4 w-4" />}
              status={
                <AccordionStatus tone={settings.breakdowns.enabled ? "on" : "off"}>
                  {settings.breakdowns.enabled ? "On" : "Off"}
                </AccordionStatus>
              }
              expanded={drawerSections.breakdowns}
              onToggle={() => {
                toggleDrawerSection("breakdowns");
              }}
            >
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={settings.breakdowns.enabled}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setSettings((s) => ({
                      ...s,
                      breakdowns: { ...s.breakdowns, enabled },
                    }));
                  }}
                  className="accent-sim-running h-4 w-4"
                />
                Enable stochastic breakdowns
              </label>
              {settings.breakdowns.enabled ? (
                <>
                  {/* VROL-822 — MTBF + MTTR are now DurationInput so the
                      user can pick min / h rather than entering raw ms. */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <DurationInput
                      id="rs-mtbf"
                      label="MTBF"
                      valueMs={settings.breakdowns.mtbfMs}
                      min={100}
                      defaultUnit="min"
                      onChangeMs={(ms) => {
                        setSettings((s) => ({
                          ...s,
                          breakdowns: { ...s.breakdowns, mtbfMs: Math.floor(ms) },
                        }));
                      }}
                    />
                    <DurationInput
                      id="rs-mttr"
                      label="MTTR"
                      valueMs={settings.breakdowns.mttrMs}
                      min={100}
                      defaultUnit="min"
                      onChangeMs={(ms) => {
                        setSettings((s) => ({
                          ...s,
                          breakdowns: { ...s.breakdowns, mttrMs: Math.floor(ms) },
                        }));
                      }}
                    />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Availability ceiling: MTBF / (MTBF + MTTR) ={" "}
                    <span className="font-mono tabular-nums">
                      {(
                        (settings.breakdowns.mtbfMs /
                          Math.max(1, settings.breakdowns.mtbfMs + settings.breakdowns.mttrMs)) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  </p>
                </>
              ) : null}
            </Accordion>

            <div className="flex justify-between gap-2">
              <div className="flex items-center gap-2">
                {confirmReset ? (
                  <>
                    <span className="text-muted-foreground text-xs">Discard all changes?</span>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        setSettings(DEFAULT_RUN_SETTINGS);
                        setConfirmReset(false);
                        toast.info("Run settings reset");
                      }}
                    >
                      Yes, reset
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setConfirmReset(false);
                      }}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // VROL-711 — require inline confirm before clobbering settings.
                      setConfirmReset(true);
                    }}
                  >
                    Reset to defaults
                  </Button>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setSettingsOpen(false);
                }}
              >
                Done
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <StationDrilldown
        open={stationDrilldownNodeId !== null}
        onOpenChange={(o) => {
          if (!o) setStationDrilldownNodeId(null);
        }}
        nodeId={stationDrilldownNodeId}
        nodeLabel={(() => {
          if (!stationDrilldownNodeId) return "";
          const n = nodes.find((nd) => nd.id === stationDrilldownNodeId);
          const raw = (n?.data as { label?: unknown })?.label;
          return typeof raw === "string" ? raw : "";
        })()}
        nodeTypeLabel={(() => {
          if (!stationDrilldownNodeId) return "";
          const n = nodes.find((nd) => nd.id === stationDrilldownNodeId);
          const t = (n?.data as { stationType?: unknown })?.stationType;
          return typeof t === "string" ? t : "station";
        })()}
        result={result}
        chainNodeIds={runMeta?.chainNodeIds ?? null}
        edges={edges.map((e) => {
          const src = nodes.find((nd) => nd.id === e.source);
          const tgt = nodes.find((nd) => nd.id === e.target);
          const srcLabel = (src?.data as { label?: unknown })?.label;
          const tgtLabel = (tgt?.data as { label?: unknown })?.label;
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            sourceLabel: typeof srcLabel === "string" ? srcLabel : undefined,
            targetLabel: typeof tgtLabel === "string" ? tgtLabel : undefined,
          };
        })}
      />
      <WizardShell
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
        }}
        onFinish={(draft, mode) => {
          const commit = commitWizardDraft(draft);
          setNodes(commit.nodes);
          setEdges(commit.edges);
          // VROL-871 — merge the rebuilt wizard patch with the same care the
          // landing-page handoff applies: spread source/breakdowns onto the
          // base block so unrelated keys (e.g. animateFlow) stay put.
          setSettings((s) => {
            const patch = commit.settingsPatch;
            return {
              ...s,
              horizonMs: patch.horizonMs,
              warmupMs: typeof patch.warmupMs === "number" ? patch.warmupMs : s.warmupMs,
              seed: typeof patch.seed === "number" ? patch.seed : s.seed,
              replications:
                typeof patch.replications === "number"
                  ? Math.max(1, Math.min(50, Math.floor(patch.replications)))
                  : s.replications,
              interStationBufferCapacity: patch.interStationBufferCapacity,
              source: { ...s.source, ...patch.source },
              breakdowns: patch.breakdowns
                ? { ...s.breakdowns, ...patch.breakdowns }
                : s.breakdowns,
              samplerIntervalMs: patch.samplerIntervalMs,
              products: patch.products ? { ...s.products, ...patch.products } : s.products,
              workers: patch.workers ? { ...s.workers, ...patch.workers } : s.workers,
              materials: patch.materials ? { ...s.materials, ...patch.materials } : s.materials,
            };
          });
          setWizardOpen(false);
          toast.success("Scenario created", {
            description: `${String(commit.nodes.filter((n) => n.type !== "sticky" && n.type !== "frame").length)} stations · ${mode === "run" ? "running…" : "ready to run"}`,
          });
          if (mode === "run") setApplyAndRunTick((x) => x + 1);
        }}
      />
    </div>
  );
}

export default function EditorPage() {
  return (
    <div className="space-y-3 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Editor</h1>
      </header>
      <ReactFlowProvider>
        <EditorCanvas />
      </ReactFlowProvider>
    </div>
  );
}
