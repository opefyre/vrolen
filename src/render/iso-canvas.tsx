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

import type { MainToWorker, RenderEdge, RenderStation, WorkerToMain } from "./protocol";
import RenderWorker from "./render.worker?worker";

export interface IsoCanvasHandle {
  setScene(stations: readonly RenderStation[], edges: readonly RenderEdge[]): void;
  setCamera(camera: { x: number; y: number; zoom: number }): void;
}

export interface IsoCanvasProps {
  className?: string;
  onReady?: (info: { pixiVersion: string }) => void;
  onFps?: (fps: number, frameCount: number) => void;
  onError?: (info: { stage: string; message: string }) => void;
}

interface WorkerBridge {
  readonly worker: Worker;
  postScene(stations: readonly RenderStation[], edges: readonly RenderEdge[]): void;
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

  useImperativeHandle(
    ref,
    () => ({
      setScene(stations, edges) {
        bridgeRef.current?.postScene(stations, edges);
      },
      setCamera(camera) {
        bridgeRef.current?.postCamera(camera);
      },
    }),
    [],
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
      postScene(stations, edges) {
        post({ kind: "scene", stations, edges });
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

  return <div ref={wrapperRef} className={`relative ${className ?? ""}`} />;
});
