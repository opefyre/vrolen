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
  CircleDot,
  Combine,
  ConciergeBell,
  Download,
  Factory,
  FolderOpen,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  asMaterialId,
  asResourceId,
  type ChainBreakdownConfig,
  type ChainMaintenanceConfig,
  type ChainMaterialConfig,
  type ChainProductsConfig,
  type ChainResult,
  type ChainWorkerConfig,
  constant,
  type Distribution,
  meanOf,
  runChain,
  SeededPrng,
} from "@/engine";
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
import { runScenario, type ScenarioRunOutcome } from "@/lib/run-scenario";
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

const BOTTLES_ID = asMaterialId("bottles");
const CAPS_ID = asMaterialId("caps");

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

const INITIAL_NODES: Node[] = [
  {
    id: "n1",
    type: "station",
    position: { x: 80, y: 120 },
    data: {
      label: "Filler",
      stationType: "input",
      cycleDistribution: constant(50),
      defectRate: 0,
    },
  },
  {
    id: "n2",
    type: "station",
    position: { x: 320, y: 120 },
    data: {
      label: "Capper",
      stationType: "machine",
      cycleDistribution: constant(200),
      defectRate: 0,
    },
  },
  {
    id: "n3",
    type: "station",
    position: { x: 560, y: 120 },
    data: {
      label: "Labeler",
      stationType: "qc",
      cycleDistribution: constant(50),
      defectRate: 0,
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  { id: "e1-2", source: "n1", target: "n2" },
  { id: "e2-3", source: "n2", target: "n3" },
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
  [key: string]: unknown;
}

function StationNode({ data, selected }: NodeProps) {
  const d = data as StationNodeData;
  const Icon = STATION_TYPE_ICON[d.stationType ?? "machine"] ?? Factory;
  const maintenanceCount = Array.isArray(d.maintenanceWindows) ? d.maintenanceWindows.length : 0;
  const skillCount = Array.isArray(d.skills) ? d.skills.length : 0;
  const hasSetup = !!d.setupDistribution;
  const hasMatrix =
    d.changeoverMatrix && typeof d.changeoverMatrix === "object"
      ? Object.keys(d.changeoverMatrix).length > 0
      : false;

  return (
    <div
      className={`border-border bg-card min-w-[140px] rounded-md border px-3 py-2 shadow-sm transition-shadow ${
        selected ? "ring-foreground/30 ring-2" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3" />
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" />
        <div className="min-w-0 text-sm font-medium">{d.label ?? "Station"}</div>
      </div>
      {maintenanceCount + skillCount + (hasSetup ? 1 : 0) + (hasMatrix ? 1 : 0) > 0 ? (
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
import { Sparkline } from "./Sparkline";
import { ThroughputChart } from "./ThroughputChart";
const EDGE_TYPES = { animated: AnimatedEdge };

function EditorCanvas() {
  const initial = useMemo(() => loadGraph(), []);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<ChainResult | null>(null);
  const [runMeta, setRunMeta] = useState<RunMeta | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [settings, setSettings] = useState<RunSettings>(loadRunSettings);
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
  const [comparison, setComparison] = useState<{
    aName: string;
    aOutcome: ScenarioRunOutcome;
    bName: string;
    bOutcome: ScenarioRunOutcome;
  } | null>(null);
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
        materialsCfg = {
          initialInventory: [
            [BOTTLES_ID, settings.materials.bottles],
            [CAPS_ID, settings.materials.caps],
          ],
          stationRecipes: [
            {
              stationIndex,
              requirements: [
                { materialId: BOTTLES_ID, qtyPerPart: 1 },
                { materialId: CAPS_ID, qtyPerPart: 1 },
              ],
            },
          ],
          ...(settings.materials.replenishment.enabled
            ? {
                replenishments: [
                  {
                    materialId: BOTTLES_ID,
                    amount: settings.materials.replenishment.amount,
                    atMs: settings.materials.replenishment.atMs,
                  },
                ],
              }
            : {}),
        };
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
      setComparison({ aName: savedName, aOutcome, bName: "Current canvas", bOutcome });
      toast.success(`Comparing "${savedName}" vs current canvas`);
    },
    [nodes, edges, settings, selectedNodeId],
  );

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

  return (
    <div className="space-y-3">
      <div
        className={`grid h-[calc(100vh-13rem)] gap-3 ${
          selectedNode ? "grid-cols-[200px_1fr_260px]" : "grid-cols-[200px_1fr]"
        }`}
      >
        <Card className="overflow-y-auto">
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
            <div className="space-y-2 pt-2">
              <Button onClick={handleRun} disabled={isRunning} className="w-full gap-2" size="sm">
                <Play className="h-4 w-4" />
                {isRunning ? "Running…" : "Run simulation"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSettingsOpen(true);
                }}
                className="w-full gap-2"
              >
                <Settings2 className="h-4 w-4" />
                Run settings
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setScenarios(listScenarios());
                  setScenariosOpen(true);
                }}
                className="w-full gap-2"
              >
                <FolderOpen className="h-4 w-4" />
                Scenarios
              </Button>
              {confirmReset ? (
                <div
                  ref={(el) => {
                    confirmTargetRef.current = el;
                  }}
                  className="flex items-center justify-between gap-1 text-xs"
                >
                  <span className="text-muted-foreground">Reset?</span>
                  <div className="flex gap-1">
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
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfirmReset(true);
                  }}
                  className="w-full"
                >
                  Reset canvas
                </Button>
              )}
              {result && runMeta ? (
                <>
                  <div className="border-border my-2 border-t" />
                  <label className="flex items-center gap-2 text-xs font-medium">
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => {
                      const stem = suggestedFilenameStem(runMeta.stationLabels[0]);
                      downloadFile(
                        `${stem}.json`,
                        chainResultToJsonString(result),
                        "application/json",
                      );
                      toast.success("Downloaded JSON");
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Download JSON
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => {
                      const stem = suggestedFilenameStem(runMeta.stationLabels[0]);
                      downloadFile(
                        `${stem}.csv`,
                        chainResultToCsv(result, { stationLabels: runMeta.stationLabels }),
                        "text/csv",
                      );
                      toast.success("Downloaded CSV");
                    }}
                  >
                    <Download className="h-4 w-4" />
                    Download CSV
                  </Button>
                </>
              ) : null}
            </div>
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
              <DistributionEditor
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
            </CardContent>
            <CardContent className="border-border space-y-3 border-t pt-3">
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
                  htmlFor="inspector-defect"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Defect rate (0–1)
                </label>
                <Input
                  id="inspector-defect"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={Number((selectedNode.data as { defectRate?: unknown }).defectRate ?? 0)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0 && n <= 1)
                      updateSelectedNodeData({ defectRate: n });
                  }}
                  className="font-mono tabular-nums"
                />
              </div>
              <p className="text-muted-foreground text-xs">
                Position: {Math.round(selectedNode.position.x)} ,{" "}
                {Math.round(selectedNode.position.y)}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {result && runMeta ? (
        <KpiStrip
          result={result}
          runMeta={runMeta}
          horizonMs={settings.horizonMs}
          warmupMs={Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2))}
        />
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
              <ComparisonTable
                aName={comparison.aName}
                aResult={comparison.aOutcome.result}
                bName={comparison.bName}
                bResult={comparison.bOutcome.result}
              />
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
            <SheetDescription>
              Applied to every Run from /editor. Persisted to localStorage. /run page has its own
              independent fixture.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-5 px-4 pb-6">
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
                <div className="flex flex-col gap-1">
                  <label htmlFor="rs-warmup" className="text-muted-foreground text-xs font-medium">
                    Warm-up (ms)
                  </label>
                  <Input
                    id="rs-warmup"
                    type="number"
                    min={0}
                    step={1000}
                    value={settings.warmupMs}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 0) {
                        setSettings((s) => ({ ...s, warmupMs: Math.floor(n) }));
                      }
                    }}
                    className="font-mono tabular-nums"
                  />
                </div>
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
                <div className="flex flex-col gap-1">
                  <label htmlFor="rs-buf" className="text-muted-foreground text-xs font-medium">
                    Buffer capacity
                  </label>
                  <Input
                    id="rs-buf"
                    type="number"
                    min={1}
                    value={settings.interStationBufferCapacity}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n > 0) {
                        setSettings((s) => ({
                          ...s,
                          interStationBufferCapacity: Math.floor(n),
                        }));
                      }
                    }}
                    className="font-mono tabular-nums"
                  />
                </div>
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
                  Sample throughput over time (VROL-612)
                </label>
                <p className="text-muted-foreground text-xs">
                  When on, the engine snapshots line + per-station counters at the configured
                  interval; the result panel renders a throughput chart and per-station sparklines.
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
              </div>
            </section>

            <section className="border-border space-y-3 rounded-md border border-dashed p-3">
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
                <Package className="h-4 w-4" />
                Materials (1 bottle + 1 cap per part)
              </label>
              {settings.materials.enabled ? (
                <>
                  <p className="text-muted-foreground text-xs">
                    Applies to the node currently selected in the inspector{" "}
                    {selectedNodeId ? (
                      <strong className="text-foreground">({String(selectedNodeId)})</strong>
                    ) : (
                      <em>(no node selected — select one before running)</em>
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
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="rs-rep-at"
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Replenish at (ms)
                        </label>
                        <Input
                          id="rs-rep-at"
                          type="number"
                          min={0}
                          step={1000}
                          value={settings.materials.replenishment.atMs}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n >= 0) {
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
                            }
                          }}
                          className="font-mono tabular-nums"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <label
                          htmlFor="rs-rep-amt"
                          className="text-muted-foreground text-xs font-medium"
                        >
                          Bottles delivered
                        </label>
                        <Input
                          id="rs-rep-amt"
                          type="number"
                          min={1}
                          value={settings.materials.replenishment.amount}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (Number.isFinite(n) && n >= 1) {
                              setSettings((s) => ({
                                ...s,
                                materials: {
                                  ...s.materials,
                                  replenishment: {
                                    ...s.materials.replenishment,
                                    amount: Math.floor(n),
                                  },
                                },
                              }));
                            }
                          }}
                          className="font-mono tabular-nums"
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>

            <section className="border-border space-y-3 rounded-md border border-dashed p-3">
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
                <Boxes className="h-4 w-4" />
                Multi-product mix at source
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
            </section>

            <section className="border-border space-y-3 rounded-md border border-dashed p-3">
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
                <CircleDot className="h-4 w-4" />
                Workers (require 1 per station)
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
            </section>

            <section className="border-border space-y-3 rounded-md border border-dashed p-3">
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
                <Zap className="h-4 w-4" />
                Stochastic breakdowns
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
            </section>

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
      <p className="text-muted-foreground text-xs">
        When a part of the listed product arrives, this distribution overrides the default cycle
        time above. Toggle off to use the default for that product.
      </p>
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
              <DistributionEditor
                value={dist}
                onChange={(d) => {
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
        <DistributionEditor
          value={value}
          onChange={(d) => {
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

function DistributionEditor({
  value,
  onChange,
}: {
  value: Distribution;
  onChange: (d: Distribution) => void;
}) {
  const numberField = (
    label: string,
    id: string,
    fieldValue: number,
    setter: (n: number) => void,
    extras: { min?: number; max?: number; step?: number } = {},
  ) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        min={extras.min}
        max={extras.max}
        step={extras.step ?? 1}
        value={fieldValue}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) setter(n);
        }}
        className="font-mono tabular-nums"
      />
    </div>
  );

  const handleKindChange = (kind: Distribution["kind"]): void => {
    // Pick sensible defaults derived from the current distribution's mean.
    const meanGuess =
      value.kind === "constant"
        ? value.value
        : value.kind === "uniform"
          ? (value.min + value.max) / 2
          : value.kind === "normal"
            ? value.mean
            : value.kind === "triangular"
              ? (value.min + value.mode + value.max) / 3
              : 1 / value.rate;
    switch (kind) {
      case "constant":
        onChange({ kind: "constant", value: Math.max(1, Math.round(meanGuess)) });
        break;
      case "uniform":
        onChange({
          kind: "uniform",
          min: Math.max(1, Math.round(meanGuess * 0.8)),
          max: Math.max(2, Math.round(meanGuess * 1.2)),
        });
        break;
      case "normal":
        onChange({
          kind: "normal",
          mean: Math.max(1, Math.round(meanGuess)),
          stddev: Math.max(1, Math.round(meanGuess * 0.1)),
        });
        break;
      case "triangular":
        onChange({
          kind: "triangular",
          min: Math.max(1, Math.round(meanGuess * 0.7)),
          mode: Math.max(1, Math.round(meanGuess)),
          max: Math.max(2, Math.round(meanGuess * 1.5)),
        });
        break;
      case "exponential":
        onChange({ kind: "exponential", rate: 1 / Math.max(1, meanGuess) });
        break;
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-1">
        <label htmlFor="inspector-dist-kind" className="text-muted-foreground text-xs font-medium">
          Cycle distribution
        </label>
        <select
          id="inspector-dist-kind"
          value={value.kind}
          onChange={(e) => {
            handleKindChange(e.target.value as Distribution["kind"]);
          }}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="constant">Constant</option>
          <option value="uniform">Uniform</option>
          <option value="normal">Normal</option>
          <option value="triangular">Triangular</option>
          <option value="exponential">Exponential</option>
        </select>
      </div>
      {value.kind === "constant"
        ? numberField(
            "Value (ms)",
            "dist-const-value",
            value.value,
            (n) => {
              onChange({ kind: "constant", value: Math.max(1, n) });
            },
            { min: 1 },
          )
        : null}
      {value.kind === "uniform" ? (
        <div className="grid grid-cols-2 gap-2">
          {numberField(
            "Min (ms)",
            "dist-uniform-min",
            value.min,
            (n) => {
              onChange({ kind: "uniform", min: Math.max(1, n), max: value.max });
            },
            { min: 1 },
          )}
          {numberField(
            "Max (ms)",
            "dist-uniform-max",
            value.max,
            (n) => {
              onChange({ kind: "uniform", min: value.min, max: Math.max(value.min + 1, n) });
            },
            { min: value.min + 1 },
          )}
        </div>
      ) : null}
      {value.kind === "normal" ? (
        <div className="grid grid-cols-2 gap-2">
          {numberField(
            "Mean (ms)",
            "dist-normal-mean",
            value.mean,
            (n) => {
              onChange({ kind: "normal", mean: Math.max(1, n), stddev: value.stddev });
            },
            { min: 1 },
          )}
          {numberField(
            "Std dev (ms)",
            "dist-normal-stddev",
            value.stddev,
            (n) => {
              onChange({ kind: "normal", mean: value.mean, stddev: Math.max(0.1, n) });
            },
            { min: 0.1, step: 0.1 },
          )}
        </div>
      ) : null}
      {value.kind === "triangular" ? (
        <div className="grid grid-cols-3 gap-2">
          {numberField(
            "Min",
            "dist-tri-min",
            value.min,
            (n) => {
              onChange({
                kind: "triangular",
                min: Math.max(1, n),
                mode: value.mode,
                max: value.max,
              });
            },
            { min: 1 },
          )}
          {numberField(
            "Mode",
            "dist-tri-mode",
            value.mode,
            (n) => {
              onChange({
                kind: "triangular",
                min: value.min,
                mode: Math.max(value.min, n),
                max: value.max,
              });
            },
            { min: value.min },
          )}
          {numberField(
            "Max",
            "dist-tri-max",
            value.max,
            (n) => {
              onChange({
                kind: "triangular",
                min: value.min,
                mode: value.mode,
                max: Math.max(value.mode, n),
              });
            },
            { min: value.mode },
          )}
        </div>
      ) : null}
      {value.kind === "exponential" ? (
        <>
          {numberField(
            "Mean (ms)",
            "dist-exp-mean",
            Math.round(1 / value.rate),
            (n) => {
              onChange({ kind: "exponential", rate: 1 / Math.max(1, n) });
            },
            { min: 1 },
          )}
          <p className="text-muted-foreground text-xs">
            Implied rate: <span className="font-mono tabular-nums">{value.rate.toFixed(6)}</span>{" "}
            (events/ms)
          </p>
        </>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Expected ≈{" "}
        <span className="font-mono tabular-nums">
          {(3_600_000 / Math.max(1, meanOf(value))).toLocaleString("en-US", {
            maximumFractionDigits: 0,
          })}
        </span>{" "}
        parts/hour at this station alone (no blocking / starvation).
      </p>
    </div>
  );
}

const REASON_HINT: Record<string, string> = {
  starvation:
    "upstream isn't feeding it fast enough — speed up the feeder, add buffer capacity, or accept the chain rate.",
  blocking:
    "downstream can't keep up — speed up the downstream station, add buffer capacity, or accept the upstream rate.",
  breakdown: "stochastic failures are dominating — raise MTBF or reduce MTTR.",
  setup: "setup / changeover overhead is dominating — reduce setup time or batch products.",
  maintenance: "planned maintenance is dominating — schedule fewer or shorter windows.",
  idle: "this station hasn't been needed — the chain may be over-provisioned at this point.",
  running: "this station is running near full capacity.",
};

function ProductMixCard({ result }: { result: ChainResult }) {
  const entries = [...(result.perProductCompleted?.entries() ?? [])].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Product mix at sink</CardTitle>
        <CardDescription>
          Per-product completion counts. Compare to the configured intent in the Products section of
          Run settings.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {entries.map(([productId, n]) => {
            const pct = total > 0 ? (n / total) * 100 : 0;
            return (
              <div key={productId} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-foreground/80">{productId}</span>
                  <span className="font-mono tabular-nums">
                    {n.toLocaleString()} ({pct.toFixed(1)}%)
                  </span>
                </div>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div
                    className="bg-sim-running h-full rounded-full"
                    style={{ width: `${String(pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BottleneckExplanationCard({ result }: { result: ChainResult }) {
  if (result.bottlenecks.length === 0) return null;
  const sorted = [...result.bottlenecks].sort((a, b) => b.runningPct - a.runningPct);
  const head = sorted[0];
  if (!head) return null;

  const fmtPct = (pct: number) => (pct * 100).toLocaleString("en-US", { maximumFractionDigits: 1 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading text-base">Bottleneck analysis</CardTitle>
        <CardDescription>Auto-narrated from the per-station state breakdown.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 text-sm">
          <p>
            <strong>{head.label ?? String(head.stationId)}</strong> is the constraint —{" "}
            <span className="font-mono tabular-nums">{fmtPct(head.runningPct)}%</span> of time spent
            Running. Whatever drives this station's rate caps the line.
          </p>
          {sorted.slice(1).map((b) => {
            const hint = REASON_HINT[b.primaryReason] ?? "";
            return (
              <p key={String(b.stationId)} className="text-muted-foreground">
                <strong className="text-foreground">{b.label ?? String(b.stationId)}</strong> spends{" "}
                <span className="font-mono tabular-nums">{fmtPct(b.primaryReasonPct)}%</span> in{" "}
                <span className="font-medium">{b.primaryReason}</span> — {hint}
              </p>
            );
          })}
          <p className="text-muted-foreground border-border border-t pt-2">
            <strong className="text-foreground">Recommendation:</strong>{" "}
            {head.primaryReason === "running"
              ? `Speed up ${head.label ?? "the bottleneck"} (lower its cycle time) to lift the entire chain. Other stations have idle capacity.`
              : `Reduce ${head.primaryReason} on ${head.label ?? "the bottleneck"} — that's its dominant non-Running state.`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonTable({
  aName,
  aResult,
  bName,
  bResult,
}: {
  aName: string;
  aResult: ChainResult;
  bName: string;
  bResult: ChainResult;
}) {
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  type Row = {
    label: string;
    a: number;
    b: number;
    fmt: (n: number) => string;
    hideDiffWhenZero?: boolean;
  };
  const rows: Row[] = [
    {
      label: "Completed",
      a: aResult.completed,
      b: bResult.completed,
      fmt: (n) => n.toLocaleString(),
    },
    {
      label: "Throughput (parts/hour)",
      a: aResult.throughputLambda * 3_600_000,
      b: bResult.throughputLambda * 3_600_000,
      fmt: (n) => fmt(n, 0),
    },
    { label: "Line OEE", a: aResult.lineOee, b: bResult.lineOee, fmt: (n) => `${fmt(n * 100)}%` },
    {
      label: "Avg time-in-system (ms)",
      a: aResult.avgTimeInSystemW,
      b: bResult.avgTimeInSystemW,
      fmt: (n) => fmt(n, 0),
    },
    {
      label: "Line scrap rate",
      a: aResult.lineScrapRate,
      b: bResult.lineScrapRate,
      fmt: (n) => `${fmt(n * 100)}%`,
    },
  ];
  if (aResult.laborUtilization !== undefined || bResult.laborUtilization !== undefined) {
    rows.push({
      label: "Labor util",
      a: aResult.laborUtilization ?? 0,
      b: bResult.laborUtilization ?? 0,
      fmt: (n) => `${fmt(n * 100)}%`,
    });
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-border border-b text-left text-xs tracking-wide uppercase">
            <th className="py-2 pr-3 font-medium">Metric</th>
            <th className="px-3 py-2 text-right font-medium" title={aName}>
              A · {aName.length > 12 ? `${aName.slice(0, 11)}…` : aName}
            </th>
            <th className="px-3 py-2 text-right font-medium">B · {bName}</th>
            <th className="py-2 pl-3 text-right font-medium">Δ (B−A)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const delta = row.b - row.a;
            const pctDelta = row.a !== 0 ? (delta / Math.abs(row.a)) * 100 : 0;
            const isUp = delta > 0;
            return (
              <tr key={row.label} className="border-border/50 border-b last:border-0">
                <td className="py-2 pr-3">{row.label}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.fmt(row.a)}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{row.fmt(row.b)}</td>
                <td
                  className={`py-2 pl-3 text-right font-mono tabular-nums ${
                    delta === 0
                      ? "text-muted-foreground"
                      : isUp
                        ? "text-sim-running-foreground"
                        : "text-sim-down-foreground"
                  }`}
                >
                  {delta === 0 ? "0" : `${isUp ? "+" : ""}${row.fmt(delta)}`}
                  {row.a !== 0 && delta !== 0 ? (
                    <span className="text-muted-foreground ml-1">({fmt(pctDelta, 0)}%)</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function stateColor(state: string): string {
  switch (state) {
    case "Running":
      return "bg-sim-running";
    case "Starved":
      return "bg-sim-starved";
    case "BlockedOut":
      return "bg-sim-blocked";
    case "Down":
      return "bg-sim-down";
    case "Setup":
      return "bg-sim-setup";
    case "Maintenance":
      return "bg-sim-maintenance";
    case "Idle":
    default:
      return "bg-sim-idle";
  }
}

function KpiStrip({
  result,
  runMeta,
  horizonMs,
  warmupMs,
}: {
  result: ChainResult;
  runMeta: RunMeta;
  horizonMs: number;
  warmupMs: number;
}) {
  const tile = (label: string, value: string, hint?: string) => (
    <div className="border-border bg-card rounded-md border p-3">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
      <div className="font-mono text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-muted-foreground mt-0.5 text-xs">{hint}</div> : null}
    </div>
  );
  const throughputPerHour = result.throughputLambda * 3_600_000;
  const fmt = (n: number, digits = 1) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const totalScrapped = result.perStationScrapped.reduce((a, b) => a + b, 0);
  const totalBreakdowns = (result.perStationBreakdowns ?? []).reduce((a, b) => a + b, 0);
  const finalByMat = result.materialFinal ? new Map(result.materialFinal) : null;
  const finalBottles = finalByMat?.get(BOTTLES_ID) ?? null;
  const finalCaps = finalByMat?.get(CAPS_ID) ?? null;
  const hasMaterials = result.materialFinal !== undefined;
  const hasBreakdowns = result.perStationBreakdowns !== undefined;
  const hasLabor = result.laborUtilization !== undefined;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tile("Completed", result.completed.toLocaleString(), "during measurement window")}
        {tile("Throughput", fmt(throughputPerHour, 0), "parts / hour")}
        {tile("Line OEE", `${fmt(result.lineOee * 100)}%`, "geometric mean")}
        {tile("Time-in-system", `${fmt(result.avgTimeInSystemW, 0)} ms`, "average W per part")}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Per-station completed</CardTitle>
          <CardDescription>
            Counts at each station in topology order. Lower values downstream usually mean
            BlockedOut or warm-up bleed; lower upstream means Starved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {result.perStationCompleted.map((count, i) => {
              const label = runMeta.stationLabels[i] ?? `Station ${String(i + 1)}`;
              const max = Math.max(...result.perStationCompleted, 1);
              const pct = (count / max) * 100;
              const scrap = result.perStationScrapped[i] ?? 0;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-foreground/80">{label}</span>
                    <span className="font-mono tabular-nums">
                      {count.toLocaleString()}
                      {scrap > 0 ? (
                        <span className="text-sim-down-foreground ml-2 text-xs">
                          · {scrap.toLocaleString()} scrap
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div className="bg-muted h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-sim-running h-full rounded-full transition-[width]"
                      style={{ width: `${String(pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <BottleneckExplanationCard result={result} />

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Throughput over time</CardTitle>
          <CardDescription>
            Cumulative parts that exited the system, sampled at the configured interval (VROL-613).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThroughputChart samples={result.samples} horizonMs={horizonMs} warmupMs={warmupMs} />
        </CardContent>
      </Card>

      {result.perProductCompleted && result.perProductCompleted.size > 0 ? (
        <ProductMixCard result={result} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base">Per-station state breakdown</CardTitle>
          <CardDescription>
            Time-weighted share of each state across the measurement window. Hover a segment to see
            exact percentages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {result.bottlenecks.map((b) => (
              <div key={String(b.stationId)} className="space-y-1">
                <div className="text-foreground/80 text-sm">{b.label ?? String(b.stationId)}</div>
                <div className="bg-muted flex h-2 overflow-hidden rounded-full">
                  {b.breakdown
                    .filter((seg) => seg.pct > 0.001)
                    .map((seg) => (
                      <div
                        key={seg.state}
                        title={`${seg.state}: ${(seg.pct * 100).toFixed(1)}%`}
                        className={`h-full ${stateColor(seg.state)}`}
                        style={{ width: `${String(seg.pct * 100)}%` }}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
          <div className="text-muted-foreground mt-3 flex flex-wrap gap-2 text-xs">
            {["Running", "Setup", "Maintenance", "Down", "BlockedOut", "Starved", "Idle"].map(
              (state) => (
                <span key={state} className="flex items-center gap-1.5">
                  <span className={`h-2.5 w-2.5 rounded-sm ${stateColor(state)}`} />
                  {state}
                </span>
              ),
            )}
          </div>
        </CardContent>
      </Card>
      {hasMaterials || hasBreakdowns || hasLabor || totalScrapped > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {finalBottles !== null
            ? tile(
                "Bottles left",
                finalBottles.toLocaleString(),
                finalBottles === 0 ? "depleted" : "of starting inventory",
              )
            : null}
          {finalCaps !== null
            ? tile(
                "Caps left",
                finalCaps.toLocaleString(),
                finalCaps === 0 ? "depleted" : "of starting inventory",
              )
            : null}
          {hasBreakdowns
            ? tile("Breakdowns", totalBreakdowns.toLocaleString(), "total across chain")
            : null}
          {result.replenishmentsFired !== undefined
            ? tile(
                "Replenishments",
                result.replenishmentsFired.toLocaleString(),
                "fired during run",
              )
            : null}
          {hasLabor
            ? tile(
                "Labor util",
                `${fmt((result.laborUtilization ?? 0) * 100, 1)}%`,
                "total worker-busy / capacity",
              )
            : null}
          {totalScrapped > 0
            ? tile(
                "Scrap",
                totalScrapped.toLocaleString(),
                `${fmt(result.lineScrapRate * 100, 1)}% line scrap rate`,
              )
            : null}
        </div>
      ) : null}
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
