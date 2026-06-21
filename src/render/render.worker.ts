/// <reference lib="webworker" />
/**
 * Render worker entry point (VROL-187).
 *
 * Owns a PixiJS v8 Application that renders into an OffscreenCanvas posted
 * over from the main thread. The main thread NEVER touches PixiJS or the
 * canvas after the initial transfer; it just streams scene + camera updates
 * over postMessage. This keeps the 60fps render loop off the React thread.
 *
 * Lifecycle:
 *   init   → constructs Pixi Application, posts {kind:'ready', pixiVersion}
 *   resize → calls renderer.resize(w, h) and updates resolution (DPR)
 *   scene  → diffs station + edge lists, updates the scene graph
 *   camera → updates the world container's transform
 *   dispose → tears down the app + closes the worker
 *
 * Errors are caught at every entry and reported back as {kind:'error', …}
 * so the main thread can surface them instead of failing silently.
 */

/// <reference lib="webworker" />

// PixiJS v8's auto-detect prefers the browser environment over webworker
// when both extensions are registered. The browser env's helpers reach
// for `document` at init time, which doesn't exist in a Worker. Stub it
// with a minimal no-op object BEFORE importing pixi so the eager init
// path doesn't throw, then let the webworker environment take over at
// runtime via the extension priority dance.
//
// We only stub the surface the eager-load path needs: createElement /
// getElementById / body / head. Real DOM operations are routed to the
// WebWorker environment by PixiJS after init.
const scopeAny = self as unknown as Record<string, unknown>;
if (typeof scopeAny.document === "undefined") {
  // PixiJS's eager init in v8 calls document.createElement('canvas') to
  // build auxiliary buffers (text atlases, render textures). In a Worker
  // we can return a real OffscreenCanvas so getContext() works; for
  // anything else we return a no-op stub.
  const stubEl = {
    appendChild: () => undefined,
    setAttribute: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    style: {},
  };
  const wrapCanvas = (canvas: OffscreenCanvas): OffscreenCanvas =>
    new Proxy(canvas, {
      set(target, key, value) {
        // OffscreenCanvas demands unsigned-long for width/height; PixiJS
        // sometimes passes undefined or fractional intermediates while
        // computing render-buffer sizes. Coerce to a safe int.
        if (key === "width" || key === "height") {
          const n = Math.max(1, Math.floor(Number(value) || 1));
          Reflect.set(target, key, n);
          return true;
        }
        return Reflect.set(target, key, value);
      },
    });
  const fakeCreateElement = (tag: string): unknown => {
    if (tag === "canvas") {
      return wrapCanvas(new OffscreenCanvas(1, 1));
    }
    return stubEl;
  };
  scopeAny.document = {
    createElement: fakeCreateElement,
    createElementNS: (_ns: string, tag: string) => fakeCreateElement(tag),
    getElementById: () => null,
    body: stubEl,
    head: stubEl,
    documentElement: stubEl,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

// Geometry-only — text labels overlay on the main thread via HTML in
// IsoCanvas, so the renderer never needs `document` for font measurement.
import { Application, Container, Graphics } from "pixi.js";

import { depthKey, worldToScreen } from "./isometric";
import {
  isMainToWorker,
  type MainToWorker,
  type RenderEdge,
  type RenderStation,
  type WorkerToMain,
} from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let app: Application | null = null;
// Set true only after `await app.init()` resolves. Resize / camera / scene
// messages that arrive in the gap between `new Application()` and the init
// callback finishing should no-op (they'll be re-driven once the main
// thread sees the `ready` event).
let appReady = false;
let world: Container | null = null;
let stationLayer: Container | null = null;
let edgeLayer: Container | null = null;
const stationNodes = new Map<string, { container: Container; lastState: string }>();
const edgeNodes = new Map<string, Graphics>();
let dpr = 1;

// Sampled FPS for reporting back to the main thread for diagnostics. Reset
// every second so the number stays a true short-window rate.
let frameCount = 0;
let lastFpsPostMs = 0;

function post(msg: WorkerToMain): void {
  scope.postMessage(msg);
}

function reportError(
  stage: WorkerToMain extends { stage: infer S } ? S : never,
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  post({ kind: "error", stage, message });
}

async function handleInit(msg: Extract<MainToWorker, { kind: "init" }>): Promise<void> {
  try {
    dpr = msg.dpr;
    app = new Application();
    // PixiJS v8 in a Web Worker — pass `manageImports: false` to opt out
    // of dynamic-import side effects that touch `document`. The renderer
    // itself runs fine on OffscreenCanvas with the WebGL pipeline.
    await app.init({
      canvas: msg.canvas as unknown as HTMLCanvasElement,
      width: msg.width,
      height: msg.height,
      resolution: dpr,
      autoDensity: false,
      background: 0xf6f8fa,
      antialias: true,
      preference: "webgl",
      manageImports: false,
    });
    // World container — camera transforms apply here so child layers can
    // be authored in flat world-space and pan/zoom is just one matrix.
    world = new Container();
    world.label = "world";
    edgeLayer = new Container();
    edgeLayer.label = "edges";
    stationLayer = new Container();
    stationLayer.label = "stations";
    // VROL-191 — enable PixiJS auto-sort so containers respect zIndex.
    // Each station container gets a zIndex derived from depthKey(world),
    // which keeps closer-to-camera sprites in front of those behind them.
    stationLayer.sortableChildren = true;
    edgeLayer.sortableChildren = true;
    // Edges below stations so connections don't draw over node faces.
    world.addChild(edgeLayer);
    world.addChild(stationLayer);
    app.stage.addChild(world);

    // Bootstrap placeholder: a centred dotted box so the user sees the
    // renderer is alive before any scene arrives. Text labels live in
    // main-thread HTML (see above note).
    const placeholder = new Graphics();
    placeholder.label = "placeholder";
    placeholder
      .roundRect(-80, -16, 160, 32, 4)
      .stroke({ color: 0x7a8290, width: 1, alignment: 0.5 });
    placeholder.x = msg.width / 2;
    placeholder.y = msg.height / 2;
    app.stage.addChild(placeholder);

    // Frame-counter ticker → posts FPS every ~1s for diagnostics. The 1s
    // throttle keeps postMessage spam off the main thread.
    app.ticker.add(() => {
      frameCount += 1;
      const now = performance.now();
      if (now - lastFpsPostMs > 1000) {
        const fps = app?.ticker.FPS ?? 0;
        post({ kind: "fps", fps: Math.round(fps), frameCount });
        lastFpsPostMs = now;
      }
    });

    appReady = true;
    post({ kind: "ready", pixiVersion: "8" });
  } catch (err) {
    reportError("init", err);
  }
}

function handleResize(msg: Extract<MainToWorker, { kind: "resize" }>): void {
  if (!appReady || !app) return;
  try {
    dpr = msg.dpr;
    app.renderer.resolution = dpr;
    app.renderer.resize(msg.width, msg.height);
  } catch (err) {
    reportError("resize", err);
  }
}

function handleCamera(msg: Extract<MainToWorker, { kind: "camera" }>): void {
  if (!appReady || !world) return;
  try {
    world.x = msg.x;
    world.y = msg.y;
    world.scale.set(msg.zoom);
  } catch (err) {
    reportError("camera", err);
  }
}

const STATION_COLORS: Record<RenderStation["state"], number> = {
  idle: 0x9ca3af,
  running: 0x22c55e,
  blocked: 0xf97316,
  starved: 0xeab308,
  down: 0xef4444,
  setup: 0x3b82f6,
};

function drawStation(s: RenderStation): Container {
  const c = new Container();
  c.label = `station:${s.id}`;
  // Body — rounded rect tinted by state. PixiJS Graphics v8 API.
  // No text label here; labels overlay on the main thread (HTML) so we
  // can use real CSS + a11y + i18n without dragging `document` into the
  // worker. The container's screen position drives where the label sits.
  const body = new Graphics();
  body
    .roundRect(-40, -16, 80, 32, 6)
    .fill({ color: STATION_COLORS[s.state] })
    .stroke({ color: s.isBottleneck ? 0xf97316 : 0x111827, width: s.isBottleneck ? 2 : 1 });
  c.addChild(body);
  // Project world tile coords → screen px via the isometric helper
  // (VROL-191). The world container's own transform handles camera pan/zoom,
  // so per-sprite math uses the IDENTITY camera here.
  const screen = worldToScreen({ x: s.x, y: s.y, z: s.z });
  c.x = screen.sx;
  c.y = screen.sy;
  // Depth-sort key carried on the container so the parent layer can
  // sortChildren() to resolve occlusion.
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

function handleScene(msg: Extract<MainToWorker, { kind: "scene" }>): void {
  if (!appReady || !app || !stationLayer || !edgeLayer) return;
  try {
    // Drop placeholder on first real scene.
    const placeholder = app.stage.getChildByLabel("placeholder", true);
    if (placeholder) placeholder.removeFromParent();

    // Cache projected screen positions so the edge pass can connect line
    // endpoints without re-projecting (and so we never disagree about
    // where a station "is" between the two passes).
    const positions = new Map<string, { x: number; y: number }>();
    const seenStations = new Set<string>();
    for (const s of msg.stations) {
      const screen = worldToScreen({ x: s.x, y: s.y, z: s.z });
      positions.set(s.id, { x: screen.sx, y: screen.sy });
      seenStations.add(s.id);
      const existing = stationNodes.get(s.id);
      if (existing && existing.lastState === s.state) {
        existing.container.x = screen.sx;
        existing.container.y = screen.sy;
        existing.container.zIndex = depthKey({ x: s.x, y: s.y, z: s.z }) * 1000;
      } else {
        existing?.container.removeFromParent();
        const container = drawStation(s);
        stationLayer.addChild(container);
        stationNodes.set(s.id, { container, lastState: s.state });
      }
    }
    // Remove stations no longer in the scene.
    for (const [id, n] of stationNodes) {
      if (seenStations.has(id)) continue;
      n.container.removeFromParent();
      stationNodes.delete(id);
    }

    // Edges — simpler full rebuild for now; render is cheap when the count
    // is in the dozens and a diff-pass adds complexity without payoff.
    for (const g of edgeNodes.values()) g.removeFromParent();
    edgeNodes.clear();
    for (const e of msg.edges) {
      const a = positions.get(e.sourceId);
      const b = positions.get(e.targetId);
      if (!a || !b) continue;
      const g = drawEdge(e, a, b);
      edgeLayer.addChild(g);
      edgeNodes.set(e.id, g);
    }
  } catch (err) {
    reportError("scene", err);
  }
}

function handleDispose(): void {
  appReady = false;
  app?.destroy(true, { children: true, texture: true });
  app = null;
  world = null;
  stationLayer = null;
  edgeLayer = null;
  stationNodes.clear();
  edgeNodes.clear();
  scope.close();
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!isMainToWorker(data)) return;
  switch (data.kind) {
    case "init":
      void handleInit(data);
      break;
    case "resize":
      handleResize(data);
      break;
    case "scene":
      handleScene(data);
      break;
    case "camera":
      handleCamera(data);
      break;
    case "dispose":
      handleDispose();
      break;
  }
});
