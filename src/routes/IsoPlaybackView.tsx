/**
 * VROL-854 (Sprint 198) — Playback view for the editor.
 *
 * Renders the current scenario in the Pixi iso canvas. Uses:
 *   - VROL-858 scenarioToIsoLayout for tile-space positions
 *   - VROL-855 scenarioToRender for station state + edge shape
 *   - VROL-187 IsoCanvas for the WebGL worker
 *
 * Read-only view: no drag / connect / edit — the AC calls out that
 * clicking a station should later open a KPI sheet (future ticket).
 * Camera pan by drag, zoom by wheel — inherited from IsoCanvas.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Edge, Node } from "@xyflow/react";

import { IsoCanvas, type IsoCanvasHandle } from "@/render/iso-canvas";
import { scenarioToIsoLayout } from "@/render/scenario-to-iso-layout";
import { scenarioToRender } from "@/render/scenario-to-render";
import type { ChainResult } from "@/engine";

interface Props {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly result: ChainResult | null;
  readonly className?: string;
}

export function IsoPlaybackView({ nodes, edges, result, className }: Props): ReactElement {
  const canvasRef = useRef<IsoCanvasHandle>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const layout = scenarioToIsoLayout(nodes, edges);
    const render = scenarioToRender(nodes, edges, result);
    // Override the pixel-scale positions from scenarioToRender with the
    // topo-sort tile coords from scenarioToIsoLayout so the view reads
    // as a proper iso factory floor rather than a shrunken editor.
    const laidOut = render.stations.map((s) => {
      const p = layout.positions.get(s.id);
      return p ? { ...s, x: p.x, y: p.y } : s;
    });
    canvas.setScene(laidOut, render.edges);
  }, [ready, nodes, edges, result]);

  // Centre the scene on ready so the topology lands in the viewport
  // instead of at the origin, which the world camera would show far
  // off-screen.
  useEffect(() => {
    if (!ready) return;
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const rect = wrapper.getBoundingClientRect();
    const layout = scenarioToIsoLayout(nodes, edges);
    const midLayer = layout.layerCount > 0 ? (layout.layerCount - 1) / 2 : 0;
    // Tile-to-pixel: 64/2 per unit iso-x plus rough centre offset.
    const camera = {
      x: rect.width / 2 - midLayer * 32,
      y: rect.height / 2 - midLayer * 16,
      zoom: 1,
    };
    cameraRef.current = camera;
    canvas.setCamera(camera);
    // Intentionally only re-centres on ready. Nodes/edges changes
    // rebuild the scene above but preserve the current camera so the
    // user's pan isn't clobbered mid-inspection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div
      ref={wrapperRef}
      className={`bg-muted/20 relative h-full w-full overflow-hidden rounded-md border ${className ?? ""}`}
      data-testid="iso-playback-view"
    >
      <IsoCanvas
        ref={canvasRef}
        className="h-full w-full"
        onReady={() => {
          setReady(true);
        }}
      />
      <div className="text-muted-foreground pointer-events-none absolute right-3 bottom-3 rounded bg-white/85 px-2 py-1 text-[10px] shadow-sm ring-1 ring-gray-200">
        Playback view · read-only
      </div>
    </div>
  );
}
