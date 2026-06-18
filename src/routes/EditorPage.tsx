/**
 * /editor — scenario authoring canvas (VROL-262 + VROL-265).
 *
 * Phase 0 scaffolding: react-flow canvas with a station palette on the left.
 * Drag a station from the palette onto the canvas to drop a new node; connect
 * with edges. Persisted to localStorage so reloads survive.
 *
 * Real engine integration (turn the graph into a chain config + run it) lands
 * in a later sprint. This story is about the canvas being mountable + the
 * palette being draggable — the foundation.
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
  PackageCheck,
  Play,
  Truck,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type ChainResult, constant, runChain, SeededPrng } from "@/engine";
import { graphToChainOptions } from "@/lib/graph-to-chain";
import { toast } from "@/lib/toast";

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
        data: { label: item.label },
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
    setIsRunning(true);
    setResult(null);
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const horizonMs = 60_000;
        const r = runChain({
          stationCycleTimes: translation.cycleTimes.map((ms) => constant(ms)),
          interStationBufferCapacity: 10,
          horizonMs,
          warmupMs: 5_000,
          prng: new SeededPrng(0xc0ffee),
          stationLabels: [...translation.stationLabels],
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
  }, [nodes, edges]);

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
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tile("Completed", result.completed.toLocaleString(), "during measurement window")}
      {tile("Throughput", fmt(throughputPerHour, 0), "parts / hour")}
      {tile("Line OEE", `${fmt(result.lineOee * 100)}%`, "geometric mean")}
      {tile("Time-in-system", `${fmt(result.avgTimeInSystemW, 0)} ms`, "average W per part")}
    </div>
  );
}

export default function EditorPage() {
  return (
    <div className="space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-bold tracking-tight">Editor</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Drag stations from the palette onto the canvas. Connect with edges. Run integration (turn
          the graph into a chain config + execute it) ships in a later sprint — for now this is the
          scaffolding.
        </p>
      </header>
      <ReactFlowProvider>
        <EditorCanvas />
      </ReactFlowProvider>
    </div>
  );
}
