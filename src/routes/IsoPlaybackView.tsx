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

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { Edge, Node } from "@xyflow/react";

import { IsoCanvas, type IsoCanvasHandle } from "@/render/iso-canvas";
import { worldToScreen } from "@/render/isometric";
import { scenarioToIsoLayout } from "@/render/scenario-to-iso-layout";
import { scenarioToRender } from "@/render/scenario-to-render";
import { scenarioToWorkers, topologyIndexToNodeIdMap } from "@/render/scenario-to-workers";
import type { ChainResult } from "@/engine";

import { PlaybackHud } from "./PlaybackHud";
import {
  PlaybackCheatSheet,
  PlaybackReplayBanner,
  PlaybackStationKpiPanel,
} from "./PlaybackOverlays";

interface Props {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly result: ChainResult | null;
  /**
   * VROL-856 — optional playback scrubber time. When provided, edge
   * dots position deterministically from this instead of auto-loop.
   */
  readonly simTimeMs?: number;
  readonly className?: string;
}

export function IsoPlaybackView({
  nodes,
  edges,
  result,
  simTimeMs,
  className,
}: Props): ReactElement {
  const canvasRef = useRef<IsoCanvasHandle>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState<boolean>(false);
  const cameraRef = useRef({ x: 0, y: 0, zoom: 1 });
  // VROL-232 — mirror the camera + wrapper rect into React state so
  // the HUD's SVG arrow can retrace to the bottleneck's projected
  // position whenever either changes.
  const [cameraState, setCameraState] = useState({ x: 0, y: 0, zoom: 1 });
  const [wrapperSize, setWrapperSize] = useState({ w: 0, h: 0 });
  // VROL-1191 — heatmap toggle, persisted so the pick survives reload.
  const [heatmapOn, setHeatmapOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage?.getItem?.("vrolen.playback.heatmap") === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage?.setItem?.("vrolen.playback.heatmap", heatmapOn ? "1" : "0");
    } catch {
      /* private mode / quota */
    }
  }, [heatmapOn]);
  // VROL-1190 — click-to-KPI drawer for the selected station.
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  // VROL-1192 — ? cheat sheet overlay.
  const [cheatSheetOpen, setCheatSheetOpen] = useState<boolean>(false);

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
    // VROL-212 — worker sprites derived from perStationRunningPct.
    const idxToNodeId = topologyIndexToNodeIdMap(nodes, result?.perStationLabels ?? []);
    const workers = scenarioToWorkers(layout, result, idxToNodeId);
    const options: {
      simTimeMs?: number;
      workers?: readonly (typeof workers)[number][];
      heatmap?: boolean;
    } = { heatmap: heatmapOn };
    if (simTimeMs !== undefined) options.simTimeMs = simTimeMs;
    if (workers.length > 0) options.workers = workers;
    canvas.setScene(laidOut, render.edges, options);
  }, [ready, nodes, edges, result, simTimeMs, heatmapOn]);

  // VROL-217 — F focuses bottleneck; VROL-1192 — ? opens cheat sheet;
  // Escape closes overlays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) {
          return;
        }
      }
      if (e.key === "Escape") {
        if (cheatSheetOpen) {
          e.preventDefault();
          setCheatSheetOpen(false);
        } else if (selectedStationId !== null) {
          e.preventDefault();
          setSelectedStationId(null);
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setCheatSheetOpen((v) => !v);
        return;
      }
      if (e.key !== "f" && e.key !== "F") return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const layout = scenarioToIsoLayout(nodes, edges);
      const render = scenarioToRender(nodes, edges, result);
      const focusStation = render.stations.find((s) => s.isBottleneck) ?? render.stations[0];
      if (!focusStation) return;
      const pos = layout.positions.get(focusStation.id);
      if (!pos) return;
      e.preventDefault();
      canvas.focusOn(pos);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [nodes, edges, result, cheatSheetOpen, selectedStationId]);

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
    setCameraState(camera);
    canvas.setCamera(camera);
    // Intentionally only re-centres on ready. Nodes/edges changes
    // rebuild the scene above but preserve the current camera so the
    // user's pan isn't clobbered mid-inspection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // VROL-217 — pan (drag), zoom (wheel, cursor-anchored). IsoCanvas
  // clamps the resulting camera to bounds so the floor stays visible.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !ready) return;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      wrapper.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent): void => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const cam = cameraRef.current;
      const next = { x: cam.x + dx, y: cam.y + dy, zoom: cam.zoom };
      cameraRef.current = next;
      setCameraState(next);
      canvasRef.current?.setCamera(next);
    };
    const onUp = (e: PointerEvent): void => {
      dragging = false;
      try {
        wrapper.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer may already be released */
      }
    };
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const cam = cameraRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const zoom = Math.max(0.25, Math.min(4, cam.zoom * factor));
      const rect = wrapper.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const wx = (px - cam.x) / cam.zoom;
      const wy = (py - cam.y) / cam.zoom;
      const next = { x: px - wx * zoom, y: py - wy * zoom, zoom };
      cameraRef.current = next;
      setCameraState(next);
      canvasRef.current?.setCamera(next);
    };
    wrapper.addEventListener("pointerdown", onDown);
    wrapper.addEventListener("pointermove", onMove);
    wrapper.addEventListener("pointerup", onUp);
    wrapper.addEventListener("pointercancel", onUp);
    wrapper.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      wrapper.removeEventListener("pointerdown", onDown);
      wrapper.removeEventListener("pointermove", onMove);
      wrapper.removeEventListener("pointerup", onUp);
      wrapper.removeEventListener("pointercancel", onUp);
      wrapper.removeEventListener("wheel", onWheel);
    };
  }, [ready]);

  // VROL-232 — track wrapper size for the HUD SVG layer.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = (): void => {
      const rect = wrapper.getBoundingClientRect();
      setWrapperSize({ w: rect.width, h: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => {
      ro.disconnect();
    };
  }, []);

  // VROL-232 — compute bottleneck station's screen position from the
  // iso layout + current camera. Memoised so the HUD only rebuilds
  // when a genuine input changes.
  const bottleneck = useMemo(() => {
    const layout = scenarioToIsoLayout(nodes, edges);
    const render = scenarioToRender(nodes, edges, result);
    const b = render.stations.find((s) => s.isBottleneck);
    if (!b) return { at: null, label: undefined };
    const world = layout.positions.get(b.id);
    if (!world) return { at: null, label: b.label };
    const screen = worldToScreen({ x: world.x, y: world.y }, cameraState);
    return { at: { x: screen.sx, y: screen.sy }, label: b.label };
  }, [nodes, edges, result, cameraState]);

  // VROL-1190 — click hitboxes at each station's projected screen
  // position. HTML on top of the canvas so hit-testing bypasses Pixi
  // and the pointer handler for pan doesn't fire on station clicks.
  const stationClickTargets = useMemo(() => {
    const layout = scenarioToIsoLayout(nodes, edges);
    const render = scenarioToRender(nodes, edges, result);
    return render.stations
      .map((s) => {
        const world = layout.positions.get(s.id);
        if (!world) return null;
        const screen = worldToScreen({ x: world.x, y: world.y }, cameraState);
        return { id: s.id, label: s.label, x: screen.sx, y: screen.sy };
      })
      .filter((v): v is { id: string; label: string; x: number; y: number } => v !== null);
  }, [nodes, edges, result, cameraState]);

  // VROL-1190 — lookup selected station's topology index for the KPI panel.
  const kpiIdx = useMemo(() => {
    if (selectedStationId === null || !result) return null;
    const map = topologyIndexToNodeIdMap(nodes, result.perStationLabels ?? []);
    for (const [idx, nodeId] of map) {
      if (nodeId === selectedStationId) return idx;
    }
    return null;
  }, [selectedStationId, nodes, result]);
  const selectedStation = stationClickTargets.find((s) => s.id === selectedStationId) ?? null;

  return (
    <div
      ref={wrapperRef}
      className={`bg-muted/20 relative h-full w-full overflow-hidden rounded-md border ${className ?? ""}`}
      data-testid="iso-playback-view"
      style={{ touchAction: "none" }}
    >
      <IsoCanvas
        ref={canvasRef}
        className="h-full w-full"
        onReady={() => {
          setReady(true);
        }}
      />
      {/* VROL-1190 — click hitboxes at station centres. 40×20 diamond
          bounds; pointer-events-auto so clicks register. */}
      <div className="pointer-events-none absolute inset-0 z-[5]">
        {stationClickTargets.map((s) => (
          <button
            key={s.id}
            type="button"
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-orange-400"
            style={{
              left: s.x,
              top: s.y,
              width: 80,
              height: 32,
              background: "transparent",
            }}
            aria-label={`Open KPIs for ${s.label}`}
            data-testid={`playback-station-hit-${s.id}`}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedStationId(s.id);
            }}
          />
        ))}
      </div>
      <PlaybackReplayBanner hasResult={result !== null} isLive={simTimeMs !== undefined} />
      <PlaybackHud
        result={result}
        {...(simTimeMs !== undefined ? { simTimeMs } : {})}
        bottleneckAt={bottleneck.at}
        {...(bottleneck.label ? { bottleneckLabel: bottleneck.label } : {})}
        wrapperWidth={wrapperSize.w}
        wrapperHeight={wrapperSize.h}
        heatmapOn={heatmapOn}
        onToggleHeatmap={() => {
          setHeatmapOn((v) => !v);
        }}
      />
      <PlaybackStationKpiPanel
        stationId={selectedStationId}
        stationLabel={selectedStation?.label ?? null}
        result={result}
        topologyIndex={kpiIdx}
        onClose={() => {
          setSelectedStationId(null);
        }}
      />
      <PlaybackCheatSheet
        open={cheatSheetOpen}
        onClose={() => {
          setCheatSheetOpen(false);
        }}
      />
      <div className="text-muted-foreground pointer-events-none absolute right-3 bottom-3 rounded bg-white/85 px-2 py-1 text-[10px] shadow-sm ring-1 ring-gray-200">
        Playback · click a station · F focus · ? shortcuts
      </div>
    </div>
  );
}
