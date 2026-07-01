/**
 * <IsoCanvas /> — main-thread React shell that hosts a PixiJS renderer
 * running in a Web Worker via OffscreenCanvas (VROL-187).
 *
 * Threading model:
 *   - Main thread: React + DOM + ResizeObserver + setScene / setCamera API.
 *   - Worker: PixiJS Application + scene graph + 60fps render loop.
 *   - Boundary: a single OffscreenCanvas transferred at init, then
 *     postMessage updates for scene / camera / resize / dispose.
 *
 * The worker (src/render/render.worker.ts) carries all PixiJS knowledge.
 * This component never imports `pixi.js` — the bundle only loads it inside
 * the worker chunk, so the main thread stays responsive while the renderer
 * does its work off-thread.
 *
 * Falls back to a friendly status panel when OffscreenCanvas is unavailable
 * (older Safari, restricted environments). The same shell renders either
 * way — only the canvas + worker pipe goes away.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { TILE_HEIGHT, TILE_WIDTH, worldToScreen } from "./isometric";
import type {
  MainToWorker,
  RenderEdge,
  RenderStation,
  RenderWorker,
  WorkerToMain,
} from "./protocol";
import RenderWorker from "./render.worker?worker";

export interface IsoCanvasHandle {
  setScene(
    stations: readonly RenderStation[],
    edges: readonly RenderEdge[],
    options?: {
      /** VROL-856 — playback scrubber time in ms. When provided,
       *  edge dots position deterministically from it. */
      readonly simTimeMs?: number;
      /** VROL-212 — worker sprites on the top layer. */
      readonly workers?: readonly RenderWorker[];
    },
  ): void;
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  /** VROL-217 — imperatively pan the camera so the given world point
   *  sits at the wrapper's centre. Zoom preserved. */
  focusOn(world: { x: number; y: number }): void;
}

export interface IsoCanvasProps {
  className?: string;
  onReady?: (info: { pixiVersion: string }) => void;
  onFps?: (fps: number, frameCount: number) => void;
  onError?: (info: { stage: string; message: string }) => void;
}

interface WorkerBridge {
  readonly worker: Worker;
  postScene(
    stations: readonly RenderStation[],
    edges: readonly RenderEdge[],
    simTimeMs?: number,
    workers?: readonly RenderWorker[],
  ): void;
  postCamera(camera: { x: number; y: number; zoom: number }): void;
  postResize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

export const IsoCanvas = forwardRef<IsoCanvasHandle, IsoCanvasProps>(function IsoCanvas(
  { className, onReady, onFps, onError },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bridgeRef = useRef<WorkerBridge | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  // VROL-857 — HTML label overlay state. Labels ride on top of the
  // WebGL canvas as absolutely-positioned divs so we can use real
  // CSS + i18n + a11y without pulling `document` into the worker.
  const [labels, setLabels] = useState<readonly RenderStation[]>([]);
  const [camera, setCameraState] = useState<{ x: number; y: number; zoom: number }>({
    x: 0,
    y: 0,
    zoom: 1,
  });

  // VROL-217 — clamp camera to bounds derived from the floor tile
  // radius (VROL-199 draws [-20, +20]²). Prevents the user from
  // panning into a completely empty grey background.
  const FLOOR_RADIUS_TILES = 20;
  const clampCamera = (next: {
    x: number;
    y: number;
    zoom: number;
  }): { x: number; y: number; zoom: number } => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return next;
    const rect = wrapper.getBoundingClientRect();
    const zoom = Math.max(0.25, Math.min(4, next.zoom));
    // Floor spans FLOOR_RADIUS_TILES * TILE_WIDTH * zoom in each iso
    // direction. Allow the user to pan just past the edge by a
    // wrapper-size margin so a station near the corner stays reachable.
    const floorHalfPx = FLOOR_RADIUS_TILES * TILE_WIDTH * zoom;
    const marginX = rect.width;
    const marginY = rect.height;
    return {
      zoom,
      x: Math.max(-floorHalfPx - marginX, Math.min(rect.width + floorHalfPx + marginX, next.x)),
      y: Math.max(
        -floorHalfPx - marginY,
        Math.min(rect.height + floorHalfPx * (TILE_HEIGHT / TILE_WIDTH) + marginY, next.y),
      ),
    };
  };

  useImperativeHandle(
    ref,
    () => ({
      setScene(stations, edges, options) {
        bridgeRef.current?.postScene(stations, edges, options?.simTimeMs, options?.workers);
        setLabels(stations);
      },
      setCamera(nextCamera) {
        const clamped = clampCamera(nextCamera);
        bridgeRef.current?.postCamera(clamped);
        setCameraState(clamped);
      },
      focusOn(world) {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        // Solve: worldToScreen(world, cam).sx === rect.width/2, .sy === rect.height/2
        // Use the identity projection then centre-offset the camera.
        const identity = worldToScreen(world);
        const zoom = camera.zoom;
        const next = clampCamera({
          x: rect.width / 2 - identity.sx * zoom,
          y: rect.height / 2 - identity.sy * zoom,
          zoom,
        });
        bridgeRef.current?.postCamera(next);
        setCameraState(next);
      },
    }),
    [camera.zoom],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // VROL-187 — gate on the two browser APIs the worker bridge needs.
    // Without OffscreenCanvas there's no way to transfer the canvas; without
    // transferControlToOffscreen the call would throw. Older Safari + every
    // restricted env (some kiosks, embedded webviews) lands in the fallback.
    if (
      typeof OffscreenCanvas === "undefined" ||
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== "function"
    ) {
      setUnsupported(
        "WebGL renderer requires OffscreenCanvas. Falling back to the graph editor view.",
      );
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    wrapper.appendChild(canvas);

    let disposed = false;
    let worker: Worker | null = null;
    try {
      worker = new RenderWorker();
    } catch (err) {
      onError?.({
        stage: "init",
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const post = (msg: MainToWorker, transfer: Transferable[] = []) => {
      worker?.postMessage(msg, transfer);
    };

    worker.addEventListener("message", (e: MessageEvent<WorkerToMain>) => {
      if (disposed) return;
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      switch (msg.kind) {
        case "ready":
          onReady?.({ pixiVersion: msg.pixiVersion });
          break;
        case "fps":
          onFps?.(msg.fps, msg.frameCount);
          break;
        case "error":
          onError?.({ stage: msg.stage, message: msg.message });
          break;
      }
    });

    worker.addEventListener("error", (e) => {
      if (disposed) return;
      onError?.({ stage: "init", message: e.message || "Worker error" });
    });

    const rect = wrapper.getBoundingClientRect();
    const initialW = Math.max(1, Math.floor(rect.width));
    const initialH = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    let offscreen: OffscreenCanvas;
    try {
      offscreen = canvas.transferControlToOffscreen();
    } catch (err) {
      onError?.({
        stage: "init",
        message: err instanceof Error ? err.message : String(err),
      });
      worker.terminate();
      worker = null;
      return;
    }
    post({ kind: "init", canvas: offscreen, width: initialW, height: initialH, dpr }, [offscreen]);

    const bridge: WorkerBridge = {
      worker,
      postScene(stations, edges, simTimeMs, workers) {
        const msg: MainToWorker = { kind: "scene", stations, edges };
        if (simTimeMs !== undefined) msg.simTimeMs = simTimeMs;
        if (workers !== undefined) msg.workers = workers;
        post(msg);
      },
      postCamera(camera) {
        post({ kind: "camera", x: camera.x, y: camera.y, zoom: camera.zoom });
      },
      postResize(width, height, d) {
        post({ kind: "resize", width, height, dpr: d });
      },
      dispose() {
        post({ kind: "dispose" });
      },
    };
    bridgeRef.current = bridge;

    const ro = new ResizeObserver((entries) => {
      if (disposed) return;
      const e = entries[0];
      if (!e) return;
      bridge.postResize(
        Math.max(1, Math.floor(e.contentRect.width)),
        Math.max(1, Math.floor(e.contentRect.height)),
        window.devicePixelRatio || 1,
      );
    });
    ro.observe(wrapper);

    return () => {
      disposed = true;
      ro.disconnect();
      bridge.dispose();
      bridgeRef.current = null;
      // Give the worker a tick to process the dispose before terminating,
      // so PixiJS gets a chance to clean up GL resources.
      const w = worker;
      worker = null;
      setTimeout(() => {
        w?.terminate();
      }, 0);
      if (canvas.parentElement === wrapper) {
        wrapper.removeChild(canvas);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (unsupported) {
    return (
      <div
        ref={wrapperRef}
        className={`border-border bg-muted/30 flex items-center justify-center rounded-md border p-6 text-center text-sm ${className ?? ""}`}
        role="status"
      >
        <div className="text-muted-foreground max-w-md">
          <div className="text-foreground mb-1 font-medium">Renderer unavailable</div>
          {unsupported}
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className={`relative ${className ?? ""}`}>
      {/* VROL-857 — HTML label overlay. Absolutely-positioned divs
          projected through the same worldToScreen the worker uses so
          the labels track sprites through camera pan/zoom. Pointer
          events off so clicks pass through to the canvas. */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        data-testid="iso-labels"
      >
        {labels.map((s) => {
          const p = worldToScreen({ x: s.x, y: s.y, z: s.z }, camera);
          return (
            <div
              key={s.id}
              className="absolute -translate-x-1/2 rounded-sm bg-white/85 px-1.5 py-0.5 text-[10px] font-medium text-gray-800 shadow-sm ring-1 ring-gray-200"
              style={{ left: p.sx, top: p.sy + 22 }}
              data-testid={`iso-label-${s.id}`}
            >
              {s.label}
            </div>
          );
        })}
      </div>
    </div>
  );
});
