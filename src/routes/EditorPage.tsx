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
  MiniMap,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnConnect,
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
  Factory,
  Package,
  PackageCheck,
  Play,
  Settings2,
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
  type ChainMaterialConfig,
  type ChainResult,
  type ChainWorkerConfig,
  constant,
  runChain,
  SeededPrng,
} from "@/engine";
import { graphToChainOptions } from "@/lib/graph-to-chain";
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

const INITIAL_NODES: Node[] = [
  {
    id: "n1",
    type: "default",
    position: { x: 80, y: 120 },
    data: { label: "Filler", cycleMs: 50, defectRate: 0 },
  },
  {
    id: "n2",
    type: "default",
    position: { x: 320, y: 120 },
    data: { label: "Capper", cycleMs: 200, defectRate: 0 },
  },
  {
    id: "n3",
    type: "default",
    position: { x: 560, y: 120 },
    data: { label: "Labeler", cycleMs: 50, defectRate: 0 },
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
    return {
      nodes: parsed.nodes && parsed.nodes.length > 0 ? parsed.nodes : INITIAL_NODES,
      edges: parsed.edges ?? [],
    };
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

function EditorCanvas() {
  const initial = useMemo(() => loadGraph(), []);
  const [nodes, setNodes] = useState<Node[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<ChainResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [settings, setSettings] = useState<RunSettings>(loadRunSettings);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);

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
        type: "default",
        position,
        data: { label: item.label, cycleMs: 100, defectRate: 0 },
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
    nodeIdRef.current = INITIAL_NODES.length + 1;
    toast.info("Editor reset");
  };

  const handleRun = useCallback((): void => {
    const translation = graphToChainOptions(nodes, edges);
    if (translation.error) {
      toast.error("Can't run", { description: translation.error });
      return;
    }
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

    const workersCfg: ChainWorkerConfig | undefined = settings.workers.enabled
      ? {
          workers: Array.from({ length: Math.max(1, settings.workers.count) }, (_, i) => ({
            id: asResourceId(`w${String(i + 1)}`),
            name: `Worker ${String(i + 1)}`,
            skills: ["any"],
            shifts: [{ startMs: 0, endMs: Math.max(1, settings.workers.shiftEndMs) }],
          })),
          requireDefault: ["any"],
        }
      : undefined;

    setIsRunning(true);
    setResult(null);
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const r = runChain({
          stationCycleTimes: translation.cycleTimes.map((ms) => constant(ms)),
          interStationBufferCapacity: settings.interStationBufferCapacity,
          horizonMs: settings.horizonMs,
          warmupMs: Math.min(settings.warmupMs, Math.floor(settings.horizonMs / 2)),
          prng: new SeededPrng(settings.seed),
          stationLabels: [...translation.stationLabels],
          ...(materialsCfg ? { materials: materialsCfg } : {}),
          ...(breakdownsCfg ? { breakdowns: breakdownsCfg } : {}),
          ...(workersCfg ? { workers: workersCfg } : {}),
        });
        const wallMs = performance.now() - t0;
        setResult(r);
        toast.success("Simulation complete", {
          description: `${r.completed.toLocaleString()} parts in ${wallMs.toFixed(0)}ms wall-clock`,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error("Simulation failed", { description: message });
      } finally {
        setIsRunning(false);
      }
    }, 0);
  }, [nodes, edges, selectedNodeId, settings]);

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
              <Button variant="outline" size="sm" onClick={handleReset} className="w-full">
                Reset canvas
              </Button>
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
            nodes={nodes}
            edges={edges}
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
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="inspector-cycle"
                  className="text-muted-foreground text-xs font-medium"
                >
                  Cycle time (ms)
                </label>
                <Input
                  id="inspector-cycle"
                  type="number"
                  min={1}
                  step={1}
                  value={Number((selectedNode.data as { cycleMs?: unknown }).cycleMs ?? 100)}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n > 0) updateSelectedNodeData({ cycleMs: n });
                  }}
                  className="font-mono tabular-nums"
                />
              </div>
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
              <p className="text-muted-foreground border-border border-t pt-2 text-xs">
                Position: {Math.round(selectedNode.position.x)} ,{" "}
                {Math.round(selectedNode.position.y)}
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {result ? <KpiStrip result={result} /> : null}

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
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="rs-worker-count"
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Worker count
                      </label>
                      <Input
                        id="rs-worker-count"
                        type="number"
                        min={1}
                        max={20}
                        value={settings.workers.count}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n >= 1) {
                            setSettings((s) => ({
                              ...s,
                              workers: { ...s.workers, count: Math.floor(n) },
                            }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label
                        htmlFor="rs-worker-shift"
                        className="text-muted-foreground text-xs font-medium"
                      >
                        Shift end (ms)
                      </label>
                      <Input
                        id="rs-worker-shift"
                        type="number"
                        min={1000}
                        step={1000}
                        value={settings.workers.shiftEndMs}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n > 0) {
                            setSettings((s) => ({
                              ...s,
                              workers: { ...s.workers, shiftEndMs: Math.floor(n) },
                            }));
                          }
                        }}
                        className="font-mono tabular-nums"
                      />
                    </div>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {settings.workers.count >= 3
                      ? "≥3 workers — no labor bottleneck on a 3-station chain."
                      : settings.workers.count === 1
                        ? "Single worker — chain is rate-limited by labor."
                        : `${String(settings.workers.count)} workers — partial labor contention.`}
                  </p>
                </>
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

function KpiStrip({ result }: { result: ChainResult }) {
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
      {hasMaterials || hasBreakdowns || hasLabor ? (
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
