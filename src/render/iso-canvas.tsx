/**
 * <IsoCanvas /> — main-thread React component that hosts the PixiJS worker
 * (VROL-187).
 *
 * Owns:
 *   • the <canvas> DOM node
 *   • the Worker that renders into it via OffscreenCanvas
 *   • a ResizeObserver that streams dims into the worker
 *   • the message bridge for ready/fps/error notifications
 *
 * Scene updates are pushed via the imperative `setScene(stations, edges)` +
 * `setCamera({x, y, zoom})` methods exposed on a ref. We deliberately AVOID
 * a React reconciler over PixiJS — the worker holds the scene graph and we
 * stream state diffs into it. (See VROL-191 for projection helpers; this
 * component renders flat coords until that ticket lands.)
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import type { MainToWorker, RenderEdge, RenderStation, WorkerToMain } from "./protocol";

export interface IsoCanvasHandle {
  /** Replace the scene atomically. */
  setScene(stations: readonly RenderStation[], edges: readonly RenderEdge[]): void;
  /** Update the camera transform. */
  setCamera(camera: { x: number; y: number; zoom: number }): void;
}

export interface IsoCanvasProps {
  /** Tailwind className applied to the wrapper div. */
  className?: string;
  /** Called once the worker has finished `init` and PixiJS reports ready. */
  onReady?: (info: { pixiVersion: string }) => void;
  /** Called with sampled FPS from the worker (~1 Hz). */
  onFps?: (fps: number, frameCount: number) => void;
  /** Called when the worker reports an error from any stage. */
  onError?: (info: { stage: string; message: string }) => void;
}

export const IsoCanvas = forwardRef<IsoCanvasHandle, IsoCanvasProps>(function IsoCanvas(
  { className, onReady, onFps, onError },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  // Imperative handle so callers stream scene + camera updates without
  // triggering React re-renders for every frame.
  useImperativeHandle(
    ref,
    () => ({
      setScene(stations, edges) {
        const w = workerRef.current;
        if (!w) return;
        const msg: MainToWorker = { kind: "scene", stations, edges };
        w.postMessage(msg);
      },
      setCamera(camera) {
        const w = workerRef.current;
        if (!w) return;
        const msg: MainToWorker = { kind: "camera", ...camera };
        w.postMessage(msg);
      },
    }),
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;

    // Capability gate — OffscreenCanvas is the architecture's load-bearing
    // primitive; if it's missing (older Safari, locked-down embedded
    // browsers) we surface that explicitly instead of failing silently.
    if (typeof OffscreenCanvas === "undefined" || !canvas.transferControlToOffscreen) {
      setUnsupported(
        "OffscreenCanvas isn't available in this browser. Vrolen's 2.5D renderer needs it; falling back to the graph editor view.",
      );
      return;
    }

    let disposed = false;
    try {
      const offscreen = canvas.transferControlToOffscreen();
      const worker = new Worker(new URL("./render.worker.ts", import.meta.url), {
        type: "module",
      });
      workerRef.current = worker;
      const rect = wrapper.getBoundingClientRect();
      const initMsg: MainToWorker = {
        kind: "init",
        canvas: offscreen,
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
        dpr: window.devicePixelRatio || 1,
      };
      worker.postMessage(initMsg, [offscreen]);

      worker.onmessage = (event: MessageEvent<WorkerToMain>) => {
        const data = event.data;
        if (!data || typeof data !== "object") return;
        switch (data.kind) {
          case "ready":
            onReady?.({ pixiVersion: data.pixiVersion });
            break;
          case "fps":
            onFps?.(data.fps, data.frameCount);
            break;
          case "error":
            onError?.({ stage: data.stage, message: data.message });
            break;
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setUnsupported(`Renderer init failed: ${message}`);
      return;
    }

    // ResizeObserver streams logical dimensions into the worker so the
    // canvas stays sharp across pane resizes + dpr changes (browser zoom).
    const ro = new ResizeObserver((entries) => {
      if (disposed) return;
      const e = entries[0];
      if (!e) return;
      const box = e.contentRect;
      const w = workerRef.current;
      if (!w) return;
      const msg: MainToWorker = {
        kind: "resize",
        width: Math.max(1, Math.floor(box.width)),
        height: Math.max(1, Math.floor(box.height)),
        dpr: window.devicePixelRatio || 1,
      };
      w.postMessage(msg);
    });
    ro.observe(wrapper);

    return () => {
      disposed = true;
      ro.disconnect();
      const w = workerRef.current;
      if (w) {
        const msg: MainToWorker = { kind: "dispose" };
        w.postMessage(msg);
        // Give the worker a tick to drain before terminating in case it
        // needs to flush a final FPS post or error.
        setTimeout(() => w.terminate(), 0);
      }
      workerRef.current = null;
    };
    // Callback identities mustn't re-mount the worker — eslint-disable-next-line
    // captures the intentional one-time init.
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
      <canvas
        ref={canvasRef}
        // Width/height get controlled by the worker via OffscreenCanvas resize;
        // CSS keeps the on-screen size in sync with the wrapper.
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
});
