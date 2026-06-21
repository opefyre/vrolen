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

import { Application, Container, Graphics, Text } from "pixi.js";

import {
  isMainToWorker,
  type MainToWorker,
  type RenderEdge,
  type RenderStation,
  type WorkerToMain,
} from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;

let app: Application | null = null;
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
    await app.init({
      canvas: msg.canvas as unknown as HTMLCanvasElement,
      width: msg.width,
      height: msg.height,
      resolution: dpr,
      autoDensity: false,
      background: 0xf6f8fa,
      antialias: true,
      preference: "webgl",
    });
    // World container — camera transforms apply here so child layers can
    // be authored in flat world-space and pan/zoom is just one matrix.
    world = new Container();
    world.label = "world";
    edgeLayer = new Container();
    edgeLayer.label = "edges";
    stationLayer = new Container();
    stationLayer.label = "stations";
    // Edges below stations so connections don't draw over node faces.
    world.addChild(edgeLayer);
    world.addChild(stationLayer);
    app.stage.addChild(world);

    // Bootstrap placeholder so the user sees the renderer is alive before
    // any scene arrives. Removed on first scene update.
    const placeholder = new Text({
      text: "PixiJS renderer ready · awaiting scene",
      style: { fontFamily: "monospace", fontSize: 14, fill: 0x7a8290 },
    });
    placeholder.label = "placeholder";
    placeholder.x = msg.width / 2 - placeholder.width / 2;
    placeholder.y = msg.height / 2 - placeholder.height / 2;
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

    post({ kind: "ready", pixiVersion: "8" });
  } catch (err) {
    reportError("init", err);
  }
}

function handleResize(msg: Extract<MainToWorker, { kind: "resize" }>): void {
  if (!app) return;
  try {
    dpr = msg.dpr;
    app.renderer.resolution = dpr;
    app.renderer.resize(msg.width, msg.height);
  } catch (err) {
    reportError("resize", err);
  }
}

function handleCamera(msg: Extract<MainToWorker, { kind: "camera" }>): void {
  if (!world) return;
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
  const body = new Graphics();
  body
    .roundRect(-40, -16, 80, 32, 6)
    .fill({ color: STATION_COLORS[s.state] })
    .stroke({ color: s.isBottleneck ? 0xf97316 : 0x111827, width: s.isBottleneck ? 2 : 1 });
  c.addChild(body);
  // Label centered.
  const label = new Text({
    text: s.label,
    style: { fontFamily: "Inter, sans-serif", fontSize: 11, fill: 0xffffff, fontWeight: "600" },
  });
  label.anchor.set(0.5);
  c.addChild(label);
  // Position via isometric projection (placeholder — VROL-191 will swap in
  // the real helper). For now: 1:1 world→pixel so smoke tests can verify
  // the scene-update pipe end-to-end.
  c.x = s.x;
  c.y = s.y;
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
  if (!app || !stationLayer || !edgeLayer) return;
  try {
    // Drop placeholder on first real scene.
    const placeholder = app.stage.getChildByLabel("placeholder", true);
    if (placeholder) placeholder.removeFromParent();

    const positions = new Map<string, { x: number; y: number }>();
    // Rebuild station layer — diff-by-id, mutate existing where possible.
    const seenStations = new Set<string>();
    for (const s of msg.stations) {
      positions.set(s.id, { x: s.x, y: s.y });
      seenStations.add(s.id);
      const existing = stationNodes.get(s.id);
      if (existing && existing.lastState === s.state) {
        existing.container.x = s.x;
        existing.container.y = s.y;
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
