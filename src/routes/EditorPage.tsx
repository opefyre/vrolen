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
  Truck,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    data: { label: "Filler" },
  },
  {
    id: "n2",
    type: "default",
    position: { x: 320, y: 120 },
    data: { label: "Capper" },
  },
  {
    id: "n3",
    type: "default",
    position: { x: 560, y: 120 },
    data: { label: "Labeler" },
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
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const flow = useReactFlow();
  const nodeIdRef = useRef<number>(
    initial.nodes.reduce((max, n) => Math.max(max, parseInt(n.id.replace(/\D/g, ""), 10) || 0), 0) +
      1,
  );

  useEffect(() => {
    saveGraph({ nodes, edges });
  }, [nodes, edges]);

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
    nodeIdRef.current = INITIAL_NODES.length + 1;
    toast.info("Editor reset");
  };

  return (
    <div className="grid h-[calc(100vh-9rem)] grid-cols-[200px_1fr] gap-3">
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
          <Button variant="outline" size="sm" onClick={handleReset} className="mt-4 w-full">
            Reset canvas
          </Button>
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
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
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
