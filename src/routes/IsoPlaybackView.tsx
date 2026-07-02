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
import { interpolateResultAt } from "@/render/interpolate-result";
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
  // VROL-1235 — hovered station for the highlight ring / tooltip.
  const [hoveredStationId, setHoveredStationId] = useState<string | null>(null);
  // VROL-1192 — ? cheat sheet overlay.
  const [cheatSheetOpen, setCheatSheetOpen] = useState<boolean>(false);

  // VROL-226 — snapshot the result at simTimeMs so the scene reflects
  // where the run WAS at that moment, not the final steady-state.
  // No simTimeMs → hand the raw result through unchanged.
  const effectiveResult = useMemo(() => {
    if (!result || simTimeMs === undefined) return result;
    return interpolateResultAt(result, simTimeMs);
  }, [result, simTimeMs]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = scenarioToRender(nodes, edges, effectiveResult);
    // VROL-1238 — was overriding render.stations x/y with the pure
    // topological layout from scenarioToIsoLayout, so moving a station
    // in /editor had no effect on /editor?view=playback ("stuck to
    // each other" feedback). Now we use the editor's tile coords
    // (converted from n.position / TILE_PX inside scenarioToRender)
    // directly. Only fall back to the topo layout when the editor
    // positions are all stacked at (0,0) — brand-new scenarios that
    // never went through auto-layout.
    const allAtOrigin = render.stations.every((s) => s.x === 0 && s.y === 0);
    // VROL-1239 — see stationWorldCoords memo for the spacing rationale.
    const SPACING_MULT = 2.6;
    const laidOut = allAtOrigin
      ? (() => {
          const fallback = scenarioToIsoLayout(nodes, edges);
          return render.stations.map((s) => {
            const p = fallback.positions.get(s.id);
            return p ? { ...s, x: p.x, y: p.y } : s;
          });
        })()
      : render.stations.map((s) => ({ ...s, x: s.x * SPACING_MULT, y: s.y * SPACING_MULT }));
    // VROL-212 — worker sprites derived from perStationRunningPct.
    // The topo layout still drives worker start positions so multiple
    // workers spread across the line rather than clumping.
    const workerLayout = scenarioToIsoLayout(nodes, edges);
    const idxToNodeId = topologyIndexToNodeIdMap(nodes, effectiveResult?.perStationLabels ?? []);
    const workers = scenarioToWorkers(workerLayout, effectiveResult, idxToNodeId);
    const options: {
      simTimeMs?: number;
      workers?: readonly (typeof workers)[number][];
      heatmap?: boolean;
    } = { heatmap: heatmapOn };
    if (simTimeMs !== undefined) options.simTimeMs = simTimeMs;
    if (workers.length > 0) options.workers = workers;
    canvas.setScene(laidOut, render.edges, options);
  }, [ready, nodes, edges, effectiveResult, simTimeMs, heatmapOn]);

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
      // VROL-1238 — focus on the editor-derived position; only fall
      // back to topological when the scenario is degenerate.
      const render = scenarioToRender(nodes, edges, effectiveResult);
      const focusStation = render.stations.find((s) => s.isBottleneck) ?? render.stations[0];
      if (!focusStation) return;
      let pos: { x: number; y: number } = { x: focusStation.x, y: focusStation.y };
      if (pos.x === 0 && pos.y === 0) {
        const fb = scenarioToIsoLayout(nodes, edges).positions.get(focusStation.id);
        if (fb) pos = fb;
      }
      e.preventDefault();
      canvas.focusOn(pos);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [nodes, edges, effectiveResult, cheatSheetOpen, selectedStationId]);

  // VROL-1213 — fit-to-view on Playback entry.
  // Before this, we centred on the middle layer at zoom=1, which for a
  // 6-station line rendered everything clustered in ~200px in the middle
  // of a 1000+px canvas with overlapping click hitboxes. Now we project
  // the world-bounds of all station positions to screen, pick a zoom
  // that fits with a 15 % margin, and translate so the projected bbox
  // centres in the wrapper. Only fires on `ready` — pan/zoom + node
  // edits after entry preserve the user's current camera.
  useEffect(() => {
    if (!ready) return;
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const rect = wrapper.getBoundingClientRect();
    // VROL-1238 — fit-view now works over the editor-derived positions
    // (via scenarioToRender), matching what the sprites render at.
    const render = scenarioToRender(nodes, edges, effectiveResult);
    if (render.stations.length === 0 || rect.width === 0 || rect.height === 0) return;
    const allAtOrigin = render.stations.every((s) => s.x === 0 && s.y === 0);
    // VROL-1239 — mirror the sprite-scene spacing so fit-view frames
    // the actual expanded footprint.
    const SPACING_MULT = 2.6;
    const points: readonly { x: number; y: number }[] = allAtOrigin
      ? [...scenarioToIsoLayout(nodes, edges).positions.values()]
      : render.stations.map((s) => ({ x: s.x * SPACING_MULT, y: s.y * SPACING_MULT }));

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    // VROL-1245 — extend the world bbox by one full tile on each side.
    // Was 0.5 tiles, which at the new ISO_SPACING_MULT (VROL-1244)
    // meant tall sprites (silo, buffer stacks) could clip against the
    // wrapper edge on fresh entry.
    minX -= 1;
    maxX += 1;
    minY -= 1;
    maxY += 1;

    // Project the four world-bbox corners at zoom=1, camera=(0,0) to get
    // the raw screen bbox. worldToScreen is linear in x,y at z=0, so 4
    // corners is enough.
    const zeroCam = { x: 0, y: 0, zoom: 1 };
    const corners = [
      worldToScreen({ x: minX, y: minY }, zeroCam),
      worldToScreen({ x: maxX, y: minY }, zeroCam),
      worldToScreen({ x: minX, y: maxY }, zeroCam),
      worldToScreen({ x: maxX, y: maxY }, zeroCam),
    ];
    let sMinX = Infinity;
    let sMaxX = -Infinity;
    let sMinY = Infinity;
    let sMaxY = -Infinity;
    for (const c of corners) {
      if (c.sx < sMinX) sMinX = c.sx;
      if (c.sx > sMaxX) sMaxX = c.sx;
      if (c.sy < sMinY) sMinY = c.sy;
      if (c.sy > sMaxY) sMaxY = c.sy;
    }
    const worldW = Math.max(1, sMaxX - sMinX);
    const worldH = Math.max(1, sMaxY - sMinY);
    const margin = 0.85;
    const zoom = Math.max(
      0.4,
      Math.min(2.5, Math.min((rect.width * margin) / worldW, (rect.height * margin) / worldH)),
    );
    // Scaled bbox centre — translate so it lands at wrapper centre.
    const scaledCx = ((sMinX + sMaxX) / 2) * zoom;
    const scaledCy = ((sMinY + sMaxY) / 2) * zoom;
    const camera = {
      x: rect.width / 2 - scaledCx,
      y: rect.height / 2 - scaledCy,
      zoom,
    };
    cameraRef.current = camera;
    setCameraState(camera);
    canvas.setCamera(camera);
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
      // VROL-1237 — was `1.1` fixed factor per notch, which combined
      // with a trackpad flick delivering 5-10 notches to triple the
      // zoom in ~200 ms. Scale by deltaY magnitude (clamped) so a slow
      // two-finger scroll produces small, continuous steps and a mouse-
      // wheel click still moves meaningfully. deltaMode differs across
      // input types (0=pixel, 1=line, 2=page) — normalise to a stable
      // 0..1 range then apply exp() for a smooth exponential curve.
      const deltaPx =
        e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      // Clamp so a single huge flick doesn't over-zoom.
      const clampedDelta = Math.max(-120, Math.min(120, deltaPx));
      // 0.0025 gives ~1.04x zoom per notch at deltaY=15 (typical mouse
      // wheel), and much smaller steps for trackpad micro-scrolls.
      const factor = Math.exp(-clampedDelta * 0.0025);
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
  // VROL-1229 — sprite body sits ABOVE the tile plane (base at tile
  // center, top ~44 px up at zoom=1). Hit-testing / bottleneck ring /
  // KPI-panel anchor all want the BODY center, not the floor. Half the
  // sprite lift ≈ 22 px gets us onto the sprite silhouette.
  const SPRITE_BODY_OFFSET_PX = 22;

  // VROL-1238 — single source of truth for world-space station coords.
  // Prefers the editor's positions (n.position via scenarioToRender);
  // falls back to the topological layout only when every station is at
  // the origin (brand-new scenario that never went through auto-layout).
  // All three consumers below (sprite scene, bottleneck ring,
  // click hitboxes) now share this array so they never drift apart.
  //
  // VROL-1239 — editor pixel positions divided by TILE_PX give tile
  // coords under 3 units apart (Bottling preset: Input=0.3, Filler=1.2,
  // Capper=2.2). At iso projection with ~60 px sprites that packs
  // silhouettes into visible overlap. Multiply the editor-derived
  // coords by ISO_SPACING_MULT so the same relative layout expands
  // into non-overlapping cells; fit-view re-derives zoom afterwards.
  // Topological fallback is already spaced (VROL-1232) so it uses 1x.
  const ISO_SPACING_MULT = 2.6;
  const stationWorldCoords = useMemo(() => {
    const render = scenarioToRender(nodes, edges, effectiveResult);
    const allAtOrigin = render.stations.every((s) => s.x === 0 && s.y === 0);
    const fallback = allAtOrigin ? scenarioToIsoLayout(nodes, edges) : null;
    return render.stations.map((s) => {
      const from = fallback?.positions.get(s.id);
      return {
        id: s.id,
        x: from ? from.x : s.x * ISO_SPACING_MULT,
        y: from ? from.y : s.y * ISO_SPACING_MULT,
        label: s.label,
        isBottleneck: s.isBottleneck,
      };
    });
  }, [nodes, edges, effectiveResult]);

  const bottleneck = useMemo(() => {
    const b = stationWorldCoords.find((v) => v.isBottleneck);
    if (!b) return { at: null, label: undefined };
    const screen = worldToScreen({ x: b.x, y: b.y }, cameraState);
    return {
      at: { x: screen.sx, y: screen.sy - SPRITE_BODY_OFFSET_PX * cameraState.zoom },
      label: b.label,
    };
  }, [stationWorldCoords, cameraState]);

  // VROL-1190 — click hitboxes at each station's projected screen
  // position. HTML on top of the canvas so hit-testing bypasses Pixi
  // and the pointer handler for pan doesn't fire on station clicks.
  const stationClickTargets = useMemo(
    () =>
      stationWorldCoords.map((v) => {
        const screen = worldToScreen({ x: v.x, y: v.y }, cameraState);
        // VROL-1229 — lift hitbox to sprite body mid-height so clicks
        // land on the visible silhouette instead of the empty tile.
        return {
          id: v.id,
          label: v.label,
          x: screen.sx,
          y: screen.sy - SPRITE_BODY_OFFSET_PX * cameraState.zoom,
        };
      }),
    [stationWorldCoords, cameraState],
  );

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
          bounds; pointer-events-auto so clicks register.
          VROL-1235 — hover state now highlights an SVG ring drawn on
          the sibling HUD SVG layer (see below) so we don't have to
          repaint the Pixi scene on every mousemove. Hitbox tracks
          hover via onPointerEnter/Leave.
          VROL-1236 — clicked station gets a persistent bright blue
          selection ring rendered on the same SVG layer. */}
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
            onPointerEnter={() => {
              setHoveredStationId(s.id);
            }}
            onPointerLeave={() => {
              setHoveredStationId((prev) => (prev === s.id ? null : prev));
            }}
          />
        ))}
      </div>
      {/* VROL-1242 — hover + selection markers drawn as iso diamonds on
          the FLOOR (matching the tile shape) rather than screen-space
          ellipses that clashed with the aesthetic. Selection is a
          solid bright-blue diamond; hover is a soft white lift + fill
          on the target tile. Both track the sprite footprint, not the
          body center, so they land on the ground plane. */}
      {wrapperSize.w > 0 && wrapperSize.h > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 z-[6]"
          width={wrapperSize.w}
          height={wrapperSize.h}
          data-testid="playback-hover-select-layer"
          aria-hidden
        >
          {(() => {
            const marks: ReactElement[] = [];
            const halfW = 46 * cameraState.zoom;
            const halfH = 24 * cameraState.zoom;
            const bodyLift = SPRITE_BODY_OFFSET_PX * cameraState.zoom;
            const diamond = (cx: number, cy: number): string => {
              // Iso diamond centred on tile plane (below the sprite
              // body center by SPRITE_BODY_OFFSET_PX * zoom).
              const fy = cy + bodyLift;
              return `M ${String(cx)} ${String(fy - halfH)} L ${String(cx + halfW)} ${String(fy)} L ${String(cx)} ${String(fy + halfH)} L ${String(cx - halfW)} ${String(fy)} Z`;
            };
            if (selectedStationId !== null) {
              const sel = stationClickTargets.find((t) => t.id === selectedStationId);
              if (sel) {
                marks.push(
                  <path
                    key="select"
                    d={diamond(sel.x, sel.y)}
                    fill="#3b82f6"
                    fillOpacity={0.16}
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeLinejoin="round"
                    data-testid="playback-selection-ring"
                  />,
                );
              }
            }
            if (hoveredStationId !== null && hoveredStationId !== selectedStationId) {
              const hov = stationClickTargets.find((t) => t.id === hoveredStationId);
              if (hov) {
                marks.push(
                  <path
                    key="hover"
                    d={diamond(hov.x, hov.y)}
                    fill="#ffffff"
                    fillOpacity={0.22}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                    strokeOpacity={0.9}
                    strokeLinejoin="round"
                    data-testid="playback-hover-ring"
                  />,
                );
              }
            }
            return marks;
          })()}
        </svg>
      ) : null}
      <PlaybackReplayBanner hasResult={result !== null} isLive={simTimeMs !== undefined} />
      <PlaybackHud
        result={effectiveResult}
        runResult={result}
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
        result={effectiveResult}
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
