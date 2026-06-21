/**
 * <IsoCanvas /> — main-thread React component that hosts the PixiJS
 * renderer (VROL-187 + VROL-852).
 *
 * **Threading note (Sprint 82):** the locked stack mandates "PixiJS v8 in
 * a Web Worker via OffscreenCanvas". v8 in a worker still touches `document`
 * during init via dom-dependent helpers; pixi.js/webworker is opt-in but
 * the eager init path in the default `pixi.js` entrypoint conflicts. We
 * unblock the integration by running Pixi on the main thread for now and
 * filing VROL-853 to revisit the worker migration once we either: (a)
 * find a pixi.js v8 worker recipe that survives StrictMode + dom-eager
 * imports, or (b) switch to manually constructing `WebGLRenderer` without
 * `Application.init()` to avoid the dom-eager path.
 *
 * Imperative `setScene(stations, edges)` + `setCamera({x, y, zoom})` are
 * exposed via ref; we deliberately AVOID a React reconciler over PixiJS.
 */

import { Application, Container, Graphics } from "pixi.js";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { depthKey, worldToScreen } from "./isometric";
import type { RenderEdge, RenderStation } from "./protocol";

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

const STATION_COLORS: Record<RenderStation["state"], number> = {
  idle: 0x9ca3af,
  running: 0x22c55e,
  blocked: 0xf97316,
  starved: 0xeab308,
  down: 0xef4444,
  setup: 0x3b82f6,
};

interface RendererBundle {
  app: Application;
  world: Container;
  stationLayer: Container;
  edgeLayer: Container;
  stationNodes: Map<string, { container: Container; lastState: string }>;
  edgeNodes: Map<string, Graphics>;
}

function drawStation(s: RenderStation): Container {
  const c = new Container();
  c.label = `station:${s.id}`;
  const body = new Graphics();
  body
    .roundRect(-40, -16, 80, 32, 6)
    .fill({ color: STATION_COLORS[s.state] })
    .stroke({ color: s.isBottleneck ? 0xf97316 : 0x111827, width: s.isBottleneck ? 2 : 1 });
  c.addChild(body);
  const screen = worldToScreen({ x: s.x, y: s.y, z: s.z });
  c.x = screen.sx;
  c.y = screen.sy;
  c.zIndex = depthKey({ x: s.x, y: s.y, z: s.z }) * 1000;
  return c;
}

function drawEdge(
  e: RenderEdge,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Graphics {
  const g = new Graphics();
  g.label = `edge:${e.id}`;
  const w = e.flowRate > 0 ? 2 : 1.2;
  g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: 0x6b7280, width: w });
  return g;
}

export const IsoCanvas = forwardRef<IsoCanvasHandle, IsoCanvasProps>(function IsoCanvas(
  { className, onReady, onFps, onError },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const bundleRef = useRef<RendererBundle | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      setScene(stations, edges) {
        const b = bundleRef.current;
        if (!b) return;
        const positions = new Map<string, { x: number; y: number }>();
        const seen = new Set<string>();
        for (const s of stations) {
          const screen = worldToScreen({ x: s.x, y: s.y, z: s.z });
          positions.set(s.id, { x: screen.sx, y: screen.sy });
          seen.add(s.id);
          const existing = b.stationNodes.get(s.id);
          if (existing && existing.lastState === s.state) {
            existing.container.x = screen.sx;
            existing.container.y = screen.sy;
            existing.container.zIndex = depthKey({ x: s.x, y: s.y, z: s.z }) * 1000;
          } else {
            existing?.container.removeFromParent();
            const container = drawStation(s);
            b.stationLayer.addChild(container);
            b.stationNodes.set(s.id, { container, lastState: s.state });
          }
        }
        for (const [id, n] of b.stationNodes) {
          if (seen.has(id)) continue;
          n.container.removeFromParent();
          b.stationNodes.delete(id);
        }
        for (const g of b.edgeNodes.values()) g.removeFromParent();
        b.edgeNodes.clear();
        for (const e of edges) {
          const a = positions.get(e.sourceId);
          const z = positions.get(e.targetId);
          if (!a || !z) continue;
          const g = drawEdge(e, a, z);
          b.edgeLayer.addChild(g);
          b.edgeNodes.set(e.id, g);
        }
      },
      setCamera(camera) {
        const b = bundleRef.current;
        if (!b) return;
        b.world.x = camera.x;
        b.world.y = camera.y;
        b.world.scale.set(camera.zoom);
      },
    }),
    [],
  );

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Capability gate kept for future worker pivot — main-thread Pixi works
    // everywhere modern WebGL works, so the gate is informational for now.
    if (typeof OffscreenCanvas === "undefined") {
      setUnsupported(
        "WebGL renderer requires a modern browser. Falling back to the graph editor view.",
      );
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    wrapper.appendChild(canvas);

    let disposed = false;
    let bundle: RendererBundle | null = null;
    let fpsTimer: ReturnType<typeof setInterval> | null = null;
    let frameCount = 0;

    void (async () => {
      try {
        const rect = wrapper.getBoundingClientRect();
        const app = new Application();
        await app.init({
          canvas,
          width: Math.max(1, Math.floor(rect.width)),
          height: Math.max(1, Math.floor(rect.height)),
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          background: 0xf6f8fa,
          antialias: true,
          preference: "webgl",
        });
        if (disposed) {
          app.destroy(true, { children: true, texture: true });
          return;
        }
        const world = new Container();
        world.label = "world";
        const edgeLayer = new Container();
        edgeLayer.label = "edges";
        edgeLayer.sortableChildren = true;
        const stationLayer = new Container();
        stationLayer.label = "stations";
        stationLayer.sortableChildren = true;
        world.addChild(edgeLayer);
        world.addChild(stationLayer);
        app.stage.addChild(world);
        bundle = {
          app,
          world,
          stationLayer,
          edgeLayer,
          stationNodes: new Map(),
          edgeNodes: new Map(),
        };
        bundleRef.current = bundle;
        // FPS sampling — every second so postMessage equivalent doesn't
        // hammer React state.
        app.ticker.add(() => {
          frameCount += 1;
        });
        fpsTimer = setInterval(() => {
          if (!app.ticker) return;
          onFps?.(Math.round(app.ticker.FPS), frameCount);
        }, 1000);
        onReady?.({ pixiVersion: "8" });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onError?.({ stage: "init", message });
      }
    })();

    const ro = new ResizeObserver((entries) => {
      if (disposed) return;
      const e = entries[0];
      if (!e) return;
      const b = bundleRef.current;
      if (!b) return;
      try {
        b.app.renderer.resize(
          Math.max(1, Math.floor(e.contentRect.width)),
          Math.max(1, Math.floor(e.contentRect.height)),
        );
      } catch (err) {
        onError?.({
          stage: "resize",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    });
    ro.observe(wrapper);

    return () => {
      disposed = true;
      ro.disconnect();
      if (fpsTimer) clearInterval(fpsTimer);
      bundleRef.current = null;
      if (bundle) {
        bundle.app.destroy(true, { children: true, texture: true });
      }
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
