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
  Controls,
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
  useReactFlow,
} from "@xyflow/react";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Combine,
  ConciergeBell,
  Download,
  Factory,
  FolderOpen,
  HelpCircle,
  Hourglass,
  Loader2,
  MoreHorizontal,
  Package,
  PackageCheck,
  Play,
  Save,
  Settings2,
  Trash2,
  Truck,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Accordion, AccordionStatus } from "@/components/ui/accordion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CapacityChip } from "@/components/canvas/capacity-chip";
import { DistributionField } from "@/components/ui/distribution-field";
import { Input } from "@/components/ui/input";
import { NumberField } from "@/components/ui/number-field";
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
import { graphToChainOptions } from "@/lib/graph-to-chain";
import {
  addRun as addRunToHistory,
  listRuns as listRunHistory,
  type RunHistoryEntry,
} from "@/lib/run-history";
import { consumePendingPreset, PRESETS, type Preset } from "@/lib/presets";
import { runScenario, type ScenarioRunOutcome } from "@/lib/run-scenario";
import { validateScenario } from "@/lib/validate-scenario";
import {
  deleteScenario,
  listScenarios,
  loadScenario,
  saveScenario,
  type ScenarioSummary,
} from "@/lib/scenario-store";
import { toast } from "@/lib/toast";
import {
  DEFAULT_RUN_SETTINGS,
  loadRunSettings,
  type RunSettings,
  saveRunSettings,
} from "./editor-run-settings";

const STORAGE_KEY = "vrolen.editor-graph";

interface PaletteItem {
  readonly stationType: string;
  readonly label: string;
  readonly icon: typeof Factory;
  readonly summary: string;
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
};

const PALETTE: readonly PaletteItem[] = [
  { stationType: "machine", label: "Machine", icon: Factory, summary: "Stochastic cycle time" },
  { stationType: "manual", label: "Manual", icon: CircleDot, summary: "Worker-driven" },
  { stationType: "buffer", label: "Buffer", icon: Boxes, summary: "FIFO storage" },
  { stationType: "qc", label: "QC", icon: PackageCheck, summary: "Defect inspection" },
  { stationType: "assembly", label: "Assembly", icon: Combine, summary: "Many in, one out" },
  { stationType: "transport", label: "Transport", icon: Truck, summary: "Move parts" },
  { stationType: "input", label: "Material input", icon: ConciergeBell, summary: "Source" },
  { stationType: "output", label: "Output", icon: Wrench, summary: "Sink" },
];

/**
 * VROL-604 — Stable per-station identity, independent of the node's react-flow
 * id (which can collide after renames or palette drops). Used by the engine
 * translator to disambiguate metrics across runs.
 */
function generateStationKey(): string {
  const rand = ((Math.sin(performance.now()) + 1) / 2).toString(36).slice(2, 10);
  return `sk_${performance.now().toString(36).replace(".", "")}_${rand}`;
}

/**
 * Backfill a stationKey on every node that's missing one. Mutates a copy of the
 * provided array and returns it. Safe to call on already-keyed nodes (no-op).
 */
function ensureStationKeys(nodes: Node[]): Node[] {
  return nodes.map((n) => {
    const data = (n.data ?? {}) as Record<string, unknown>;
    if (typeof data.stationKey === "string" && data.stationKey.length > 0) return n;
    return { ...n, data: { ...data, stationKey: generateStationKey() } };
  });
}

/**
 * Default bottling line — designed to surface every interesting engine
 * feature in a single Run so a first-time visitor sees the simulator do
 * something meaningful before they touch anything.
 *
 * Topology (DAG with branching):
 *
 *               ┌─→ Filler A ─┐
 *   Input ──────┤             ├─→ Capper ─→ QC ─→ Labeler ─→ Packer
 *               └─→ Filler B ─┘                ↺
 *                                           rework on
 *                                          QC defects
 *
 * Cycle times are chosen so Capper is the bottleneck (a 180ms station
 * fed by two ~120ms parallel fillers — the buffer at Capper's input fills
 * up visibly). Plus:
 *  - Capper has a 40ms setup distribution so it goes Idle → Setup → Running
 *  - Filler A has a maintenance window at 30s–35s (visible mid-run drop)
 *  - QC has a 15% defect rate AND reworks defects back to Capper (VROL-626):
 *    completed parts that fail QC re-enter Capper's input buffer for
 *    another pass, demonstrating the side-channel rework loop.
 *
 * With the sampler on, the throughput chart shows the maintenance dip, the
 * OEE chart shows Capper's high running %, and the rework KPI tile renders
 * with a non-zero count. A complete tour in one click of Run.
 */
const INITIAL_NODES: Node[] = [
  {
    id: "n1",
    type: "station",
    position: { x: 60, y: 180 },
    data: {
      label: "Input",
      stationType: "input",
      cycleDistribution: constant(30),
      defectRate: 0,
    },
  },
  {
    id: "n2",
    type: "station",
    position: { x: 240, y: 60 },
    data: {
      label: "Filler A",
      stationType: "machine",
      cycleDistribution: constant(120),
      defectRate: 0,
      maintenanceWindows: [{ startMs: 30_000, endMs: 35_000 }],
    },
  },
  {
    id: "n3",
    type: "station",
    position: { x: 240, y: 300 },
    data: {
      label: "Filler B",
      stationType: "machine",
      cycleDistribution: constant(130),
      defectRate: 0,
    },
  },
  {
    id: "n4",
    type: "station",
    position: { x: 440, y: 180 },
    data: {
      label: "Capper",
      stationType: "machine",
      cycleDistribution: constant(180),
      setupDistribution: constant(40),
      defectRate: 0,
    },
  },
  {
    id: "n5",
    type: "station",
    position: { x: 640, y: 180 },
    data: {
      label: "QC",
      stationType: "qc",
      cycleDistribution: constant(60),
      defectRate: 0.15,
      reworkTargetNodeId: "n4",
    },
  },
  {
    id: "n6",
    type: "station",
    position: { x: 840, y: 180 },
    data: {
      label: "Labeler",
      stationType: "machine",
      cycleDistribution: constant(90),
      defectRate: 0,
    },
  },
  {
    id: "n7",
    type: "station",
    position: { x: 1040, y: 180 },
    data: {
      label: "Packer",
      stationType: "output",
      cycleDistribution: constant(30),
      defectRate: 0,
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: "e1-2", source: "n1", target: "n2" },
  { id: "e1-3", source: "n1", target: "n3" },
  { id: "e2-4", source: "n2", target: "n4" },
  { id: "e3-4", source: "n3", target: "n4" },
  { id: "e4-5", source: "n4", target: "n5" },
  { id: "e5-6", source: "n5", target: "n6" },
  { id: "e6-7", source: "n6", target: "n7" },
];

interface PersistedGraph {
  nodes: Node[];
  edges: Edge[];
}

function loadGraph(): PersistedGraph {
  if (typeof window === "undefined") return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
    const parsed = JSON.parse(raw) as Partial<PersistedGraph>;
    const baseNodes = parsed.nodes && parsed.nodes.length > 0 ? parsed.nodes : INITIAL_NODES;
    // VROL-607 — backfill stationKey before first render so a station's
    // identity survives even if the user reloads before mutating any state.
    // If the backfill changes anything, re-persist so the keys stick.
    const keyed = ensureStationKeys([...baseNodes]);
    const changed = keyed.some((n, i) => n !== baseNodes[i]);
    const result: PersistedGraph = { nodes: keyed, edges: parsed.edges ?? [] };
    if (changed) saveGraph(result);
    return result;
  } catch {
    return { nodes: INITIAL_NODES, edges: INITIAL_EDGES };
  }
}

function saveGraph(g: PersistedGraph): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(g));
  } catch {
    // Persistence unavailable — in-memory state still works.
  }
}

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
  changeoverMatrix?: Record<string, Record<string, Distribution>>;
  /** Cumulative-completed series injected by EditorPage when samples exist (VROL-614). */
  sparklineSeries?: number[];
  /** Defects from THIS station get routed to this node id instead of scrapping (VROL-627). */
  reworkTargetNodeId?: string;
  [key: string]: unknown;
}

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
};

function StationNode({ data, selected }: NodeProps) {
  const d = data as StationNodeData;
  const Icon = STATION_TYPE_ICON[d.stationType ?? "machine"] ?? Factory;
  const accent = STATION_TYPE_ACCENT[d.stationType ?? "machine"] ?? STATION_TYPE_ACCENT.machine!;
  const maintenanceCount = Array.isArray(d.maintenanceWindows) ? d.maintenanceWindows.length : 0;
  const skillCount = Array.isArray(d.skills) ? d.skills.length : 0;
  const hasSetup = !!d.setupDistribution;
  const hasMatrix =
    d.changeoverMatrix && typeof d.changeoverMatrix === "object"
      ? Object.keys(d.changeoverMatrix).length > 0
      : false;
  const hasRework = typeof d.reworkTargetNodeId === "string" && d.reworkTargetNodeId.length > 0;
  // VROL-650 — surface parallel-capacity on the node so it's discoverable
  // without opening Inspector. capacity=1 (default) shows nothing.
  const capacity =
    typeof (d as { capacity?: unknown }).capacity === "number"
      ? ((d as { capacity: number }).capacity as number)
      : 1;
  const hasParallel = capacity > 1;

  return (
    <div
      className={`bg-card min-w-[148px] rounded-lg border border-l-4 px-3 py-2 shadow-sm transition-all ${
        accent.border
      } ${
        selected
          ? "ring-foreground/40 border-foreground/30 shadow-md ring-2"
          : "border-border hover:shadow-md"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3" />
      <div className="flex items-center gap-2">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${accent.pill}`}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 truncate text-[13px] font-semibold">{d.label ?? "Station"}</div>
      </div>
      {maintenanceCount +
        skillCount +
        (hasSetup ? 1 : 0) +
        (hasMatrix ? 1 : 0) +
        (hasRework ? 1 : 0) +
        (hasParallel ? 1 : 0) >
      0 ? (
        <div className="text-muted-foreground mt-1.5 flex flex-wrap gap-1 text-[10px]">
          {maintenanceCount > 0 ? (
            <span className="bg-muted rounded-full px-1.5 py-0.5" title="Maintenance windows">
              🛠 {maintenanceCount}
            </span>
          ) : null}
          {skillCount > 0 ? (
            <span className="bg-muted rounded-full px-1.5 py-0.5" title="Required skills">
              🏷 {skillCount}
            </span>
          ) : null}
          {hasSetup ? (
            <span className="bg-muted rounded-full px-1.5 py-0.5" title="Setup time configured">
              ↻
            </span>
          ) : null}
          {hasMatrix ? (
            <span className="bg-muted rounded-full px-1.5 py-0.5" title="Changeover matrix">
              ⇄
            </span>
          ) : null}
          {hasRework ? (
            <span className="bg-muted rounded-full px-1.5 py-0.5" title="Rework target set">
              ↺
            </span>
          ) : null}
          {hasParallel ? <CapacityChip capacity={capacity} /> : null}
        </div>
      ) : null}
      {Array.isArray(d.sparklineSeries) && d.sparklineSeries.length > 1 ? (
        <div className="mt-1.5">
          <Sparkline series={d.sparklineSeries} />
        </div>
      ) : null}
      <Handle type="source" position={Position.Right} className="!h-3 !w-3" />
    </div>
  );
}

const NODE_TYPES = { station: StationNode };

// Lazy-import AnimatedEdge so its react-flow getBezierPath dependency doesn't
// bloat the first non-editor route. It's used inside this lazy-loaded file,
// so a normal import is fine.
import { AnimatedEdge } from "./AnimatedEdge";
import { OnboardingTour } from "./OnboardingTour";
import { hasSeenOnboarding } from "./onboarding-state";
import { Sparkline } from "./Sparkline";

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
    const preset = consumePendingPreset();
    if (preset) {
      const nodesCopy = preset.graph.nodes.map((n) => ({ ...n, data: { ...n.data } }));
      const edgesCopy = preset.graph.edges.map((e) => ({ ...e }));
      return {
        nodes: ensureStationKeys(nodesCopy),
        edges: edgesCopy,
        settings: { ...preset.settings },
        presetTitle: preset.title as string | undefined,
      };
    }
    const g = loadGraph();
    return {
      nodes: g.nodes,
      edges: g.edges,
      settings: loadRunSettings(),
      presetTitle: undefined as string | undefined,
    };
  });
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<ChainResult | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [settings, setSettings] = useState<RunSettings>(() => initial.settings);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [scenariosOpen, setScenariosOpen] = useState<boolean>(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>(() => listScenarios());
  const [saveNameDraft, setSaveNameDraft] = useState<string>("");
  const [activeScenarioName, setActiveScenarioName] = useState<string | null>(null);
  /** Inline-confirm state for destructive scenario actions (VROL-605). */
  const [confirmAction, setConfirmAction] = useState<{
    scenario: string;
    kind: "load" | "load-run" | "delete";
  } | null>(null);
  const [confirmReset, setConfirmReset] = useState<boolean>(false);
  /** VROL-633 — Inspector advanced section collapsed by default. */
  const [inspectorAdvancedOpen, setInspectorAdvancedOpen] = useState<boolean>(false);
  /** VROL-635 — Drawer optional-sections expanded state (closed by default). */
  const [drawerSections, setDrawerSections] = useState<{
    materials: boolean;
    products: boolean;
    workers: boolean;
    breakdowns: boolean;
    source: boolean;
  }>({ materials: false, products: false, workers: false, breakdowns: false, source: false });
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

  useEffect(() => {
    saveRunSettings(settings);
  }, [settings]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const flow = useReactFlow();
  const nodeIdRef = useRef<number>(
    initial.nodes.reduce((max, n) => Math.max(max, parseInt(n.id.replace(/\D/g, ""), 10) || 0), 0) +
      1,
  );

  useEffect(() => {
    saveGraph({ nodes, edges });
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

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const stationType = event.dataTransfer.getData("application/vrolen-station");
      if (!stationType) return;
      const item = PALETTE.find((p) => p.stationType === stationType);
      if (!item) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      const position = flow.screenToFlowPosition({
        x: event.clientX - (bounds?.left ?? 0),
        y: event.clientY - (bounds?.top ?? 0),
      });
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

  const handleReset = (): void => {
    setNodes(INITIAL_NODES);
    setEdges(INITIAL_EDGES);
    setSelectedNodeId(null);
    setResult(null);
    setRunMeta(null);
    setActiveScenarioName(null);
    nodeIdRef.current = INITIAL_NODES.length + 1;
    toast.info("Editor reset");
  };

  const handleRun = useCallback((): void => {
    // VROL-86 — scenario validation. Errors block; warnings surface as a
    // softer toast but don't block.
    const validation = validateScenario(nodes, edges, settings);
    if (validation.errors.length > 0) {
      const first = validation.errors[0]!;
      toast.error(
        `Can't run · ${String(validation.errors.length)} issue${validation.errors.length === 1 ? "" : "s"}`,
        {
          description: first.fix ? `${first.message}. ${first.fix}.` : first.message,
        },
      );
      return;
    }
    if (validation.warnings.length > 0) {
      const first = validation.warnings[0]!;
      toast.warning(
        `${String(validation.warnings.length)} validation warning${validation.warnings.length === 1 ? "" : "s"}`,
        {
          description: first.message,
        },
      );
    }
    const translation = graphToChainOptions(nodes, edges);
    if (translation.error) {
      toast.error("Can't run", { description: translation.error });
      return;
    }
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
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const r = runChain({
          // Prefer the DAG topology when the translator surfaced one (split / merge
          // graphs); otherwise fall through to the linear API so the engine builds
          // the implicit linear DAG.
          ...(translation.topology
            ? { topology: translation.topology }
            : {
                stationCycleTimes: [...translation.cycleDistributions],
                stationLabels: [...translation.stationLabels],
              }),
          interStationBufferCapacity: settings.interStationBufferCapacity,
          horizonMs: settings.horizonMs,
          warmupMs: Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2)),
          prng: new SeededPrng(settings.seed),
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
        });
        const wallMs = performance.now() - t0;
        setResult(r);
        toast.success("Simulation complete", {
          description: `${r.completed.toLocaleString()} parts in ${wallMs.toFixed(0)}ms wall-clock`,
        });
        // If a scenario is active, push a compact summary to history.
        if (activeScenarioName) {
          const summary: RunHistoryEntry = {
            completed: r.completed,
            throughputLambda: r.throughputLambda,
            lineOee: r.lineOee,
            avgTimeInSystemW: r.avgTimeInSystemW,
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
      } finally {
        setIsRunning(false);
      }
    }, 0);
  }, [nodes, edges, selectedNodeId, settings, activeScenarioName]);

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
      setComparison({
        aName: savedName,
        aResult: aOutcome.result,
        aStationLabels: aOutcome.runMeta.stationLabels,
        bName: "Current canvas",
        bResult: bOutcome.result,
        bStationLabels: bOutcome.runMeta.stationLabels,
        horizonMs,
        warmupMs,
      });
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

  // Render edges with per-edge throughput labels from the last run, if we have one.
  // When animateFlow is on, also assign the animated custom edge type so dots
  // travel along the path at a speed tied to the edge's flow rate.
  // VROL-614 — feed each station's cumulative-completed series into its node
  // data so StationNode can render a sparkline. Hidden when no result, no
  // samples, or the station isn't on the analysed chain.
  const nodesForFlow = useMemo<Node[]>(() => {
    if (!result || !runMeta || result.samples.length === 0) return nodes;
    const idxByNodeId = new Map<string, number>();
    runMeta.chainNodeIds.forEach((id, i) => idxByNodeId.set(id, i));
    return nodes.map((n) => {
      const stationIdx = idxByNodeId.get(n.id);
      if (stationIdx === undefined) {
        // Off-chain (e.g. unconnected palette drop) — strip any stale series.
        const data = n.data as Record<string, unknown>;
        if (!("sparklineSeries" in data)) return n;
        const next = { ...data };
        delete next.sparklineSeries;
        return { ...n, data: next };
      }
      const series = result.samples.map((s) => s.perStationCompleted[stationIdx] ?? 0);
      return {
        ...n,
        data: { ...(n.data as Record<string, unknown>), sparklineSeries: series },
      };
    });
  }, [nodes, result, runMeta]);

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
      // Switch to AnimatedEdge whenever we have something to render on top of
      // the stock edge — dots (animateFlow on) OR a buffer-fill sparkline.
      const usesCustomEdge = (animateFlow && flowed > 0) || bufferFillSeries !== undefined;
      return {
        ...e,
        label,
        animated: !usesCustomEdge && flowed > 0,
        ...(usesCustomEdge
          ? {
              type: "animated",
              data: {
                ...e.data,
                flowRate: animateFlow ? flowRate : 0,
                dotColorClass,
                ...(bufferFillSeries ? { bufferFillSeries } : {}),
              },
            }
          : {}),
      };
    });
  }, [edges, result, runMeta, animateFlow]);

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

  return (
    <div className="space-y-3">
      {/* VROL-632 — first-run onboarding tour. Renders nothing when !tourOpen. */}
      <OnboardingTour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false);
        }}
      />
      {/* VROL-634 — sticky top bar: scenario name + status pill + primary
          actions. Replaces the 9-button stack that used to live in the left
          column with a horizontal action hierarchy. */}
      <div className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 sticky top-0 z-20 -mx-6 flex flex-wrap items-center gap-3 border-b px-6 py-2 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-foreground/80 truncate text-sm font-semibold">
            {activeScenarioName ?? "Untitled scenario"}
          </span>
          {activeScenarioName && activeScenarioIsModified ? (
            <span className="bg-sim-setup/20 text-sim-setup-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium">
              modified
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
              Done at{" "}
              {doneAt.toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </>
          ) : (
            <>
              <CircleDot className="h-3 w-3" />
              Idle
            </>
          )}
        </span>
        <div className="ml-auto flex items-center gap-2">
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
          <Button
            onClick={handleRun}
            disabled={isRunning}
            className="gap-2"
            size="sm"
            data-tour="run-button"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning ? "Running" : "Run"}
          </Button>
        </div>
      </div>
      <div
        className={`grid h-[calc(100vh-13rem)] gap-3 ${
          selectedNode ? "grid-cols-[200px_1fr_260px]" : "grid-cols-[200px_1fr]"
        }`}
      >
        <Card className="overflow-y-auto" data-tour="palette">
          <CardHeader>
            <CardTitle className="font-heading text-base">Stations</CardTitle>
            <CardDescription>Drag onto the canvas</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {PALETTE.map((p) => (
              <div
                key={p.stationType}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/vrolen-station", p.stationType);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className="border-border bg-card hover:border-foreground/30 hover:bg-accent flex cursor-grab items-center gap-2 rounded-md border p-2 active:cursor-grabbing"
                title={p.summary}
              >
                <p.icon className="h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{p.label}</div>
                  <div className="text-muted-foreground truncate text-xs">{p.summary}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div
          ref={wrapperRef}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className="border-border bg-background overflow-hidden rounded-md border"
        >
          <ReactFlow
            nodes={nodesForFlow}
            edges={edgesForFlow}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setSelectedNodeId(n.id);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
            }}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {selectedNode ? (
          <Card className="overflow-y-auto">
            <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
              <div className="space-y-1">
                <CardTitle className="font-heading text-base">Inspector</CardTitle>
                <CardDescription className="text-xs">Editing {selectedNode.id}</CardDescription>
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
            <CardContent className="space-y-3">
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
                  ((selectedNode.data as { cycleDistribution?: Distribution }).cycleDistribution ??
                    constant(
                      Number((selectedNode.data as { cycleMs?: unknown }).cycleMs ?? 100),
                    )) as Distribution
                }
                onChange={(d) => {
                  updateSelectedNodeData({ cycleDistribution: d });
                }}
              />
              <NumberField
                id="inspector-defect"
                label="Defect rate"
                value={Number((selectedNode.data as { defectRate?: unknown }).defectRate ?? 0)}
                min={0}
                max={1}
                step={0.01}
                helperText="Probability that a finished part is defective (0–1)."
                inputClassName="font-mono tabular-nums w-32"
                onChange={(n) => {
                  updateSelectedNodeData({ defectRate: n });
                }}
              />
              <NumberField
                id="inspector-capacity"
                label="Parallel cycles"
                value={Number((selectedNode.data as { capacity?: unknown }).capacity ?? 1)}
                min={1}
                max={10}
                step={1}
                helperText="Number of parts this station processes simultaneously. Default 1."
                onChange={(n) => {
                  const v = Math.max(1, Math.min(10, Math.floor(n)));
                  updateSelectedNodeData({ capacity: v === 1 ? undefined : v });
                }}
              />
            </CardContent>
            {/* VROL-633 — advanced settings collapsed by default. Power users
                expand once; the toggle's open/closed state persists per
                station via the inspectorAdvancedOpen useState below. */}
            <CardContent className="border-border border-t pt-3">
              <button
                type="button"
                onClick={() => {
                  setInspectorAdvancedOpen((v) => !v);
                }}
                className="hover:bg-accent flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm font-medium"
                aria-expanded={inspectorAdvancedOpen}
              >
                <span>{inspectorAdvancedOpen ? "Hide" : "Show"} advanced</span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    inspectorAdvancedOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
            </CardContent>
            {inspectorAdvancedOpen ? (
              <CardContent className="space-y-3">
                <SetupTimeEditor
                  value={
                    (selectedNode.data as { setupDistribution?: Distribution }).setupDistribution ??
                    null
                  }
                  onChange={(d) => {
                    updateSelectedNodeData({ setupDistribution: d ?? undefined });
                  }}
                />
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
                <MaintenanceWindowsEditor
                  value={
                    Array.isArray(
                      (selectedNode.data as { maintenanceWindows?: unknown }).maintenanceWindows,
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
                <div className="flex flex-col gap-1">
                  <label
                    htmlFor="inspector-rework"
                    className="text-muted-foreground text-xs font-medium"
                  >
                    Rework target
                  </label>
                  <select
                    id="inspector-rework"
                    value={
                      (selectedNode.data as { reworkTargetNodeId?: string }).reworkTargetNodeId ??
                      ""
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
                    value={(selectedNode.data as { reworkPassLimit?: number }).reworkPassLimit ?? 3}
                    min={1}
                    max={10}
                    step={1}
                    helperText="After this many passes, defects scrap. Default 3."
                    onChange={(n) => {
                      const v = Math.floor(n);
                      updateSelectedNodeData({ reworkPassLimit: v === 3 ? undefined : v });
                    }}
                  />
                ) : null}
                <p className="text-muted-foreground text-[11px]">
                  Position: {Math.round(selectedNode.position.x)} ,{" "}
                  {Math.round(selectedNode.position.y)}
                </p>
              </CardContent>
            ) : null}
          </Card>
        ) : null}
      </div>

      {result && runMeta ? (
        <Suspense
          fallback={
            <div className="bg-muted h-40 animate-pulse rounded-md" aria-label="Loading results" />
          }
        >
          <ResultPanel
            result={result}
            runMeta={runMeta}
            horizonMs={settings.horizonMs}
            warmupMs={Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2))}
          />
        </Suspense>
      ) : null}

      <Sheet
        open={comparison !== null}
        onOpenChange={(open) => {
          if (!open) setComparison(null);
        }}
      >
        <SheetContent side="right" className="w-[28rem] sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Comparison</SheetTitle>
            <SheetDescription>
              Both scenarios were run with their own settings. Deltas are{" "}
              <span className="font-medium">B − A</span> (current canvas vs saved scenario).
            </SheetDescription>
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
        <SheetContent side="right" className="w-[24rem] sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Scenarios</SheetTitle>
            <SheetDescription>
              Save and restore named scenarios. Persisted locally in your browser; cloud sync lands
              later (E10).
            </SheetDescription>
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
            {scenarios.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No saved scenarios yet. Click <strong>Save current</strong> to capture the graph +
                run settings under a name.
              </p>
            ) : (
              <ul className="space-y-2">
                {scenarios.map((s) => {
                  const history = historyByScenario[s.name] ?? [];
                  return (
                    <li
                      key={s.name}
                      className="border-border bg-card flex flex-col gap-2 rounded-md border p-3"
                    >
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
                          </div>
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
                                {confirmAction.kind === "load"
                                  ? "Load? Unsaved canvas lost."
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
                                      {(h.lineOee * 100).toFixed(1)}% OEE
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
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-[24rem] sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Run settings</SheetTitle>
            <SheetDescription>Applied to every Run. Persisted across reloads.</SheetDescription>
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
                <div className="flex flex-col gap-1">
                  <label htmlFor="rs-horizon" className="text-muted-foreground text-xs font-medium">
                    Horizon (ms)
                  </label>
                  <Input
                    id="rs-horizon"
                    type="number"
                    min={1000}
                    step={1000}
                    value={settings.horizonMs}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n > 0) {
                        setSettings((s) => ({ ...s, horizonMs: Math.floor(n) }));
                      }
                    }}
                    className="font-mono tabular-nums"
                  />
                </div>
                <NumberField
                  id="rs-warmup"
                  label="Warm-up (ms)"
                  value={settings.warmupMs}
                  min={0}
                  step={1000}
                  onChange={(n) => {
                    setSettings((s) => ({ ...s, warmupMs: Math.floor(n) }));
                  }}
                />
                <div className="flex flex-col gap-1">
                  <label htmlFor="rs-seed" className="text-muted-foreground text-xs font-medium">
                    Seed
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
                <p className="text-muted-foreground text-xs">Powers charts + sparklines.</p>
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
                </div>
              ) : null}
            </Accordion>

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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="rs-mtbf"
                        className="text-muted-foreground text-xs font-medium"
                      >
                        MTBF (ms)
                      </label>
                      <Input
                        id="rs-mtbf"
                        type="number"
                        min={100}
                        step={1000}
                        value={settings.breakdowns.mtbfMs}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 100) {
                            setSettings((s) => ({
                              ...s,
                              breakdowns: { ...s.breakdowns, mtbfMs: Math.floor(n) },
                            }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="rs-mttr"
                        className="text-muted-foreground text-xs font-medium"
                      >
                        MTTR (ms)
                      </label>
                      <Input
                        id="rs-mttr"
                        type="number"
                        min={100}
                        step={500}
                        value={settings.breakdowns.mttrMs}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 100) {
                            setSettings((s) => ({
                              ...s,
                              breakdowns: { ...s.breakdowns, mttrMs: Math.floor(n) },
                            }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSettings(DEFAULT_RUN_SETTINGS);
                  toast.info("Run settings reset");
                }}
              >
                Reset to defaults
              </Button>
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
    </div>
  );
}

function SkillsField({
  value,
  onChange,
  label,
  placeholder,
  id,
  helpText,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
  placeholder?: string;
  id: string;
  helpText?: string;
}) {
  const joined = value.join(", ");
  const [draft, setDraft] = useState<string>(joined);
  const [lastJoined, setLastJoined] = useState<string>(joined);
  // Sync external value changes into the input WITHOUT using an effect
  // (avoids the react-hooks/no-setstate-in-effect lint rule). When the parent
  // edits the underlying array externally, we'll see a new `joined` and
  // adopt it during render before the user edits.
  if (joined !== lastJoined) {
    setLastJoined(joined);
    setDraft(joined);
  }

  const commit = (raw: string): void => {
    const tags = raw
      .split(/[\s,]+/g)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    onChange(Array.from(new Set(tags)));
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={(e) => {
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        className="font-mono text-sm tabular-nums"
      />
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {value.map((tag) => (
            <span
              key={tag}
              className="border-border bg-muted text-muted-foreground rounded-full border px-2 py-0.5 text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {helpText ? <p className="text-muted-foreground text-xs">{helpText}</p> : null}
    </div>
  );
}

function PerProductCyclesEditor({
  products,
  value,
  onChange,
}: {
  products: readonly { id: string; name: string; weight: number }[];
  value: Record<string, Distribution>;
  onChange: (next: Record<string, Distribution>) => void;
}) {
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

/**
 * Inline editor for a worker's break windows (VROL-617). Each row is a
 * start/end ms pair plus a trash button. End must be > start AND ≤ shiftEndMs;
 * invalid values show an inline error and don't persist. Empty list → the
 * caller drops the breaks field entirely so the engine treats the worker as
 * pre-VROL-616 / no-breaks.
 */
function BreaksEditor({
  workerIdx,
  breaks,
  shiftEndMs,
  onChange,
}: {
  workerIdx: number;
  breaks: { startMs: number; endMs: number }[];
  shiftEndMs: number;
  onChange: (next: { startMs: number; endMs: number }[]) => void;
}) {
  return (
    <div className="border-border space-y-1.5 rounded-md border border-dashed p-2">
      <div className="text-muted-foreground flex items-center justify-between text-xs font-medium">
        <span>Breaks (ms)</span>
        {breaks.length > 0 ? (
          <span className="bg-muted rounded-full px-1.5 py-0.5">
            {breaks.length} break{breaks.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
      {breaks.length === 0 ? (
        <p className="text-muted-foreground text-xs">No breaks — full shift available.</p>
      ) : null}
      {breaks.map((brk, bIdx) => {
        const invalid = brk.endMs <= brk.startMs;
        const outOfShift = brk.endMs > shiftEndMs;
        return (
          <div key={bIdx} className="flex items-center gap-1.5">
            <Input
              id={`rs-worker-${String(workerIdx)}-break-${String(bIdx)}-start`}
              type="number"
              min={0}
              step={500}
              value={brk.startMs}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (!Number.isFinite(n) || n < 0) return;
                onChange(breaks.map((b, i) => (i === bIdx ? { ...b, startMs: n } : b)));
              }}
              className="w-24 font-mono text-xs tabular-nums"
              aria-label={`Break ${String(bIdx + 1)} start`}
            />
            <span className="text-muted-foreground text-xs">→</span>
            <Input
              id={`rs-worker-${String(workerIdx)}-break-${String(bIdx)}-end`}
              type="number"
              min={0}
              step={500}
              value={brk.endMs}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (!Number.isFinite(n) || n < 0) return;
                onChange(breaks.map((b, i) => (i === bIdx ? { ...b, endMs: n } : b)));
              }}
              className="w-24 font-mono text-xs tabular-nums"
              aria-label={`Break ${String(bIdx + 1)} end`}
            />
            {invalid ? (
              <span className="text-sim-down-foreground text-[10px]">end ≤ start</span>
            ) : outOfShift ? (
              <span className="text-sim-setup-foreground text-[10px]">past shift end</span>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label={`Remove break ${String(bIdx + 1)}`}
              onClick={() => {
                onChange(breaks.filter((_, i) => i !== bIdx));
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          // Default new break to a small window so the user sees something
          // meaningful and can edit the numbers without typing both from scratch.
          const lastEnd = breaks.length > 0 ? (breaks[breaks.length - 1]?.endMs ?? 0) : 0;
          const start = Math.max(0, lastEnd);
          const end = Math.min(shiftEndMs, start + 5_000);
          onChange([...breaks, { startMs: start, endMs: end }]);
        }}
      >
        + Add break
      </Button>
    </div>
  );
}

function MaintenanceWindowsEditor({
  value,
  onChange,
}: {
  value: readonly { startMs: number; endMs: number }[];
  onChange: (next: { startMs: number; endMs: number }[]) => void;
}) {
  return (
    <div className="border-border space-y-2 rounded-md border border-dashed p-3">
      <div className="text-xs font-medium">Planned maintenance windows</div>
      {value.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          No maintenance planned. Add a window with explicit start + end (ms).
        </p>
      ) : (
        <ul className="space-y-2">
          {value.map((w, idx) => (
            <li key={idx} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`maint-${String(idx)}-start`}
                  className="text-muted-foreground text-xs font-medium"
                >
                  Start (ms)
                </label>
                <Input
                  id={`maint-${String(idx)}-start`}
                  type="number"
                  min={0}
                  step={1000}
                  value={w.startMs}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) {
                      onChange(
                        value.map((entry, i) =>
                          i === idx ? { ...entry, startMs: Math.floor(n) } : entry,
                        ),
                      );
                    }
                  }}
                  className="font-mono tabular-nums"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor={`maint-${String(idx)}-end`}
                  className="text-muted-foreground text-xs font-medium"
                >
                  End (ms)
                </label>
                <Input
                  id={`maint-${String(idx)}-end`}
                  type="number"
                  min={w.startMs + 1}
                  step={1000}
                  value={w.endMs}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > w.startMs) {
                      onChange(
                        value.map((entry, i) =>
                          i === idx ? { ...entry, endMs: Math.floor(n) } : entry,
                        ),
                      );
                    }
                  }}
                  className="font-mono tabular-nums"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove window ${String(idx + 1)}`}
                onClick={() => {
                  onChange(value.filter((_, i) => i !== idx));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => {
          const last = value[value.length - 1];
          const start = last ? last.endMs + 5_000 : 10_000;
          onChange([...value, { startMs: start, endMs: start + 5_000 }]);
        }}
      >
        Add window
      </Button>
    </div>
  );
}

function SetupTimeEditor({
  value,
  onChange,
}: {
  value: Distribution | null;
  onChange: (d: Distribution | null) => void;
}) {
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

export default function EditorPage() {
  return (
    <div className="space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Editor</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Drag stations from the palette onto the canvas. Click a node to edit its parameters in the
          inspector. Open <strong>Run settings</strong> for horizon / materials / breakdowns, then
          click <strong>Run simulation</strong>.
        </p>
      </header>
      <ReactFlowProvider>
        <EditorCanvas />
      </ReactFlowProvider>
    </div>
  );
}
