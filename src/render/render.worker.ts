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
      // VROL-1195 — native OffscreenCanvas methods (getContext,
      // transferControlToOffscreen, etc.) throw "Illegal invocation"
      // when called with the Proxy as `this` instead of the underlying
      // canvas. Return bound copies so `proxyCanvas.getContext('webgl2')`
      // dispatches to the real canvas. This unbroke Pixi's GL init in
      // v8 which probes context capabilities via getTestContext.
      get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
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

// VROL-1195 — DedicatedWorkerGlobalScope doesn't expose
// requestAnimationFrame. Pixi's ticker calls it every frame; without
// a polyfill the ticker never advances and FPS stays at 0 (the render
// loop looks alive because a first paint happens, but scene diffs never
// re-render). setTimeout at ~16ms gives a stable 60fps floor.
if (typeof (scopeAny as { requestAnimationFrame?: unknown }).requestAnimationFrame !== "function") {
  (
    scopeAny as { requestAnimationFrame: (cb: FrameRequestCallback) => number }
  ).requestAnimationFrame = (cb) =>
    setTimeout(() => cb(performance.now()), 16) as unknown as number;
  (scopeAny as { cancelAnimationFrame: (id: number) => void }).cancelAnimationFrame = (id) => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  };
}

// Geometry-only — text labels overlay on the main thread via HTML in
// IsoCanvas, so the renderer never needs `document` for font measurement.
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";

import { TILE_HEIGHT, TILE_WIDTH, depthKey, worldToScreen } from "./isometric";
import {
  isMainToWorker,
  type MainToWorker,
  type RenderEdge,
  type RenderStation,
  type RenderWorker,
  type WorkerToMain,
} from "./protocol";
import { buildPlaceholderAtlas, loadManifestAtlas } from "./sprite-atlas";

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
// VROL-199 — floor tile layer. Sits below every other layer in the world
// container so the checkered isometric grid reads as the ground plane
// under the stations + edges.
let floorLayer: Container | null = null;
// VROL-212 — worker layer. Above stations so walking workers occlude
// station bodies from the front.
let workerLayer: Container | null = null;
// VROL-237 — utilization heatmap layer. Above the floor tiles but
// below stations so the diamond overlay reads without hiding the
// station bodies. Only visible when scene msg sets heatmap=true.
let heatmapLayer: Container | null = null;
let heatmapVisible = false;
// VROL-933 — sprite trails. Dots travel along each edge at a speed
// proportional to flowRate so the live playback shows visible motion.
let dotLayer: Container | null = null;
const stationNodes = new Map<string, { container: Container; lastState: string }>();
const edgeNodes = new Map<string, Graphics>();
// Per-edge state for sprite trails: cached endpoint positions, the dot
// graphics (sized ~proportional to flowRate, capped), and each dot's
// position along the edge t ∈ [0, 1).
interface EdgeTrail {
  readonly dots: readonly Graphics[];
  readonly positions: number[];
  flowRate: number;
  /** VROL-207 — freeze in place while the source station is Down. */
  frozen: boolean;
  from: { x: number; y: number };
  to: { x: number; y: number };
}
const edgeTrails = new Map<string, EdgeTrail>();
// Cap the dot pool per edge — the AC calls for 10 parts in flight to
// stay smooth, but the eye can't follow more than ~12 dots per edge
// anyway. Density throttle.
const MAX_DOTS_PER_EDGE = 12;
// VROL-856 — latest sim time received via a scene msg. null = no
// scrubber attached; advance auto per-frame. Number = position dots
// deterministically from that time so scrub/seek is reproducible.
let simTimeMs: number | null = null;

// VROL-212 — worker sprite tracking. Each worker keeps a target
// world position (where the last scene said it should be) + a
// current world position that eases toward the target every frame.
// Interpolation gives smooth walks between stations without needing
// the caller to stream continuous positions.
interface WorkerNode {
  readonly container: Container;
  readonly body: Graphics;
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  mode: RenderWorker["mode"];
  palette: number;
}
const workerNodes = new Map<string, WorkerNode>();
// Worker sprite palettes — cycles through so multiple workers on
// screen are visually distinguishable without needing real skill
// data from the engine yet.
const WORKER_PALETTES: readonly number[] = [
  0x8b5cf6, // violet
  0x14b8a6, // teal
  0xf59e0b, // amber
  0xec4899, // pink
  0x0ea5e9, // sky
];
// Interpolation constant: fraction of remaining distance to cover
// each frame. 0.15 ≈ smooth walk over ~10 frames = ~1/6 second
// at 60fps, which reads as a brisk step without teleporting.
const WORKER_STEP_ALPHA = 0.15;
// Convert RenderEdge.flowRate (parts/sec at the playback's notional
// scale) into a t-advance per frame. The visual goal: a part/sec of 1
// completes the edge in ~2 seconds at 60 fps.
const T_ADVANCE_PER_FRAME_PER_FLOW = 1 / (2 * 60);
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
  const baseMessage = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? `\n${err.stack}` : "";
  const message = `${baseMessage}${stack}`;
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
    // VROL-933 — separate layer for sprite trails so they always paint
    // above edges (so dots don't disappear behind thick edge strokes).
    dotLayer = new Container();
    dotLayer.label = "dots";
    stationLayer = new Container();
    stationLayer.label = "stations";
    // VROL-191 — enable PixiJS auto-sort so containers respect zIndex.
    // Each station container gets a zIndex derived from depthKey(world),
    // which keeps closer-to-camera sprites in front of those behind them.
    stationLayer.sortableChildren = true;
    edgeLayer.sortableChildren = true;
    // VROL-199 — floor tile layer under everything else. Drawn once
    // in init; camera pan/zoom on the world container moves it with
    // the rest of the scene.
    floorLayer = new Container();
    floorLayer.label = "floor";
    drawFloorGrid(floorLayer);
    world.addChild(floorLayer);
    // VROL-237 — heatmap tiles above floor, below stations.
    heatmapLayer = new Container();
    heatmapLayer.label = "heatmap";
    heatmapLayer.visible = false;
    world.addChild(heatmapLayer);
    // Edges below stations so connections don't draw over node faces.
    // Dots sit between edges and stations.
    world.addChild(edgeLayer);
    world.addChild(dotLayer);
    world.addChild(stationLayer);
    // VROL-212 — workers on the top layer so a walking worker occludes
    // the station container they're heading to.
    workerLayer = new Container();
    workerLayer.label = "workers";
    workerLayer.sortableChildren = true;
    world.addChild(workerLayer);
    app.stage.addChild(world);

    // VROL-195 — load the sprite atlas. Prefers public/sprites/manifest.json
    // when present (real art); falls back to placeholder textures generated
    // programmatically so the demo still renders something for each state.
    // Errors here are non-fatal: drawStation defaults to roundRect if
    // Texture.from(name) misses.
    try {
      const manifestAtlas = await loadManifestAtlas();
      if (!manifestAtlas) buildPlaceholderAtlas(app);
    } catch (err) {
      reportError("init", err);
    }

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
    // VROL-933 — same ticker advances sprite trails along their edges so
    // the playback is visibly alive.
    app.ticker.add(() => {
      frameCount += 1;
      advanceTrails();
      advanceWorkers();
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

// VROL-199 — floor tile grid config. Half-size in tiles on each axis;
// the grid renders [-RADIUS, +RADIUS] × [-RADIUS, +RADIUS] so 40 fills
// most of the visible viewport at zoom=1 without paying for tiles the
// camera will never see. Two shades alternated by (x+y)%2 for a subtle
// checkerboard; near-white so the grid recedes behind sprites.
const FLOOR_RADIUS = 20;
const FLOOR_TINT_A = 0xeef2f7;
const FLOOR_TINT_B = 0xe4e9f0;
const FLOOR_STROKE = 0xd1d8e0;

function drawFloorGrid(layer: Container): void {
  // Single Graphics per parity so PixiJS can batch the fills instead
  // of allocating 1600+ tile containers. Two draws (A + B tint) keep
  // the checker readable without a per-tile overdraw.
  const halfW = TILE_WIDTH / 2;
  const halfH = TILE_HEIGHT / 2;
  const tileA = new Graphics();
  const tileB = new Graphics();
  const outline = new Graphics();
  for (let ty = -FLOOR_RADIUS; ty <= FLOOR_RADIUS; ty++) {
    for (let tx = -FLOOR_RADIUS; tx <= FLOOR_RADIUS; tx++) {
      const center = worldToScreen({ x: tx, y: ty });
      const isA = ((tx + ty) & 1) === 0;
      const target = isA ? tileA : tileB;
      target
        .moveTo(center.sx, center.sy - halfH)
        .lineTo(center.sx + halfW, center.sy)
        .lineTo(center.sx, center.sy + halfH)
        .lineTo(center.sx - halfW, center.sy)
        .closePath();
      outline
        .moveTo(center.sx, center.sy - halfH)
        .lineTo(center.sx + halfW, center.sy)
        .lineTo(center.sx, center.sy + halfH)
        .lineTo(center.sx - halfW, center.sy)
        .closePath();
    }
  }
  tileA.fill({ color: FLOOR_TINT_A });
  tileB.fill({ color: FLOOR_TINT_B });
  outline.stroke({ color: FLOOR_STROKE, width: 0.5, alpha: 0.6 });
  layer.addChild(tileA);
  layer.addChild(tileB);
  layer.addChild(outline);
}

// VROL-857 — sprite-based station body. Prefers the atlas texture
// ('machine-idle' as a neutral base — state signal is carried by the
// ring), falls back to a Graphics rounded-rect when the atlas hasn't
// registered any textures (e.g. tests / cold init).
const STATION_BASE_SPRITE = "machine-idle";
const STATION_HALF_W = 40;
const STATION_HALF_H = 16;
const STATION_RING_PAD = 4;

function buildStationBody(): Container {
  if (Texture.from(STATION_BASE_SPRITE)) {
    const tex = Texture.from(STATION_BASE_SPRITE);
    // Texture.from returns the empty-white 1×1 stub when the name isn't
    // registered — that would render as a tiny dot. Detect and fall back.
    if (tex.width > 1 && tex.height > 1) {
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.width = STATION_HALF_W * 2;
      sprite.height = STATION_HALF_H * 2;
      return sprite;
    }
  }
  const g = new Graphics();
  g.roundRect(-STATION_HALF_W, -STATION_HALF_H, STATION_HALF_W * 2, STATION_HALF_H * 2, 6)
    .fill({ color: 0xf3f4f6 })
    .stroke({ color: 0x111827, width: 1 });
  return g;
}

function drawStation(s: RenderStation): Container {
  const c = new Container();
  c.label = `station:${s.id}`;
  // VROL-857 — state-colored ring around the body; bottleneck bumps
  // stroke width so it reads at a glance across a busy grid.
  const ring = new Graphics();
  ring
    .roundRect(
      -(STATION_HALF_W + STATION_RING_PAD),
      -(STATION_HALF_H + STATION_RING_PAD),
      (STATION_HALF_W + STATION_RING_PAD) * 2,
      (STATION_HALF_H + STATION_RING_PAD) * 2,
      8,
    )
    .stroke({
      color: STATION_COLORS[s.state],
      width: s.isBottleneck ? 3 : 2,
      alpha: 0.95,
    });
  c.addChild(ring);
  c.addChild(buildStationBody());
  // Text labels overlay on the main thread (HTML) via IsoCanvas so we
  // can use real CSS + a11y + i18n without dragging `document` into
  // the worker. The container's screen position drives where the
  // label sits.
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

// VROL-933 — sprite-trail helpers.

function dotCountFor(flowRate: number): number {
  if (flowRate <= 0) return 0;
  // Logarithmic step so a 10x bump in flow doesn't crowd the edge.
  const n = Math.ceil(1 + Math.log10(1 + flowRate * 100));
  return Math.min(MAX_DOTS_PER_EDGE, Math.max(1, n));
}

function makeDot(): Graphics {
  // VROL-207 — part sprite. Filled disc + darker outline so it reads
  // against both light floor tiles and darker edge strokes at any zoom.
  const g = new Graphics();
  g.circle(0, 0, 4).fill({ color: 0x22c55e }).stroke({ color: 0x14532d, width: 0.75, alpha: 0.9 });
  return g;
}

function syncTrail(
  edgeId: string,
  flowRate: number,
  frozen: boolean,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  if (!dotLayer) return;
  const wanted = dotCountFor(flowRate);
  const existing = edgeTrails.get(edgeId);
  if (wanted === 0) {
    if (existing) {
      for (const d of existing.dots) d.removeFromParent();
      edgeTrails.delete(edgeId);
    }
    return;
  }
  if (existing && existing.dots.length === wanted) {
    existing.flowRate = flowRate;
    existing.frozen = frozen;
    existing.from = from;
    existing.to = to;
    return;
  }
  // Resize. Drop old, build new pool; spread positions evenly so the
  // first frame doesn't show every dot stacked at t=0.
  if (existing) for (const d of existing.dots) d.removeFromParent();
  const dots: Graphics[] = [];
  const positions: number[] = [];
  for (let i = 0; i < wanted; i++) {
    const d = makeDot();
    dotLayer.addChild(d);
    dots.push(d);
    positions.push(i / wanted);
  }
  edgeTrails.set(edgeId, { dots, positions, flowRate, frozen, from, to });
}

function advanceTrails(): void {
  // VROL-856 — deterministic mode: simTimeMs drives every dot's t so
  // scrubbing backwards or seeking snaps to a reproducible position.
  // Convention: T_ADVANCE_PER_FRAME_PER_FLOW is 1 / (2 * 60), i.e. a
  // flowRate of 1 completes the edge in 2 seconds. In sim-time terms
  // that's t = (simMs / 2000) * flowRate.
  const deterministic = simTimeMs !== null;
  for (const trail of edgeTrails.values()) {
    if (deterministic && !trail.frozen) {
      const N = trail.dots.length;
      const base = ((simTimeMs ?? 0) / 2000) * trail.flowRate;
      for (let i = 0; i < N; i++) {
        let t = (base + i / N) % 1;
        if (t < 0) t += 1;
        trail.positions[i] = t;
        const dot = trail.dots[i];
        if (!dot) continue;
        dot.x = trail.from.x + (trail.to.x - trail.from.x) * t;
        dot.y = trail.from.y + (trail.to.y - trail.from.y) * t;
      }
      continue;
    }
    // VROL-207 — frozen edges (source station Down) keep the dot pool
    // in place mid-flight rather than looping. Positions stay, sprites
    // stay, only the advance skips.
    const advance = trail.frozen ? 0 : trail.flowRate * T_ADVANCE_PER_FRAME_PER_FLOW;
    for (let i = 0; i < trail.dots.length; i++) {
      let t = (trail.positions[i] ?? 0) + advance;
      while (t >= 1) t -= 1;
      trail.positions[i] = t;
      const dot = trail.dots[i];
      if (!dot) continue;
      dot.x = trail.from.x + (trail.to.x - trail.from.x) * t;
      dot.y = trail.from.y + (trail.to.y - trail.from.y) * t;
    }
  }
}

// VROL-212 — worker sprite. Small circle body + a smaller "head" so
// the shape reads as a person from the top-down iso angle. Palette
// tints the body; mode drives the wobble in advanceWorkers.
function makeWorkerBody(palette: number): Graphics {
  const color = WORKER_PALETTES[palette % WORKER_PALETTES.length] ?? WORKER_PALETTES[0]!;
  const g = new Graphics();
  g.circle(0, -4, 5).fill({ color }).stroke({ color: 0x0f172a, width: 0.75, alpha: 0.9 });
  g.circle(0, -12, 3.5)
    .fill({ color: 0xfef3c7 })
    .stroke({ color: 0x0f172a, width: 0.75, alpha: 0.9 });
  return g;
}

function upsertWorker(w: RenderWorker): void {
  if (!workerLayer) return;
  const target = worldToScreen({ x: w.x, y: w.y, z: w.z });
  let node = workerNodes.get(w.id);
  if (!node) {
    const container = new Container();
    container.label = `worker:${w.id}`;
    const body = makeWorkerBody(w.palette);
    container.addChild(body);
    // Land on target so a newly-added worker doesn't drift in from
    // (0, 0) — only pre-existing workers ease.
    container.x = target.sx;
    container.y = target.sy;
    container.zIndex = depthKey({ x: w.x, y: w.y, z: w.z }) * 1000 + 500;
    workerLayer.addChild(container);
    node = {
      container,
      body,
      targetX: target.sx,
      targetY: target.sy,
      currentX: target.sx,
      currentY: target.sy,
      mode: w.mode,
      palette: w.palette,
    };
    workerNodes.set(w.id, node);
    return;
  }
  node.targetX = target.sx;
  node.targetY = target.sy;
  node.mode = w.mode;
  if (node.palette !== w.palette) {
    node.body.removeFromParent();
    const body = makeWorkerBody(w.palette);
    node.container.addChild(body);
    node.palette = w.palette;
  }
  node.container.zIndex = depthKey({ x: w.x, y: w.y, z: w.z }) * 1000 + 500;
}

/** Ease worker positions toward their targets + apply idle-bob wobble. */
function advanceWorkers(): void {
  for (const node of workerNodes.values()) {
    const dx = node.targetX - node.currentX;
    const dy = node.targetY - node.currentY;
    // Snap when close enough to avoid endless sub-pixel drift.
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
      node.currentX = node.targetX;
      node.currentY = node.targetY;
    } else {
      node.currentX += dx * WORKER_STEP_ALPHA;
      node.currentY += dy * WORKER_STEP_ALPHA;
    }
    let x = node.currentX;
    let y = node.currentY;
    // Idle bob: subtle sinusoidal wobble via frame count. Working
    // adds a smaller lateral shake. Walking has no extra wobble
    // beyond the ease so the motion reads as directed.
    if (node.mode === "idle") {
      y += Math.sin(frameCount * 0.1) * 0.75;
    } else if (node.mode === "working") {
      x += Math.sin(frameCount * 0.4) * 0.6;
    }
    node.container.x = x;
    node.container.y = y;
  }
}

// VROL-237 — utilization → heat color. 0 = cool blue, 0.5 = amber,
// 1 = hot red. Returns a 24-bit int for PixiJS fills.
function heatColorAt(util: number): number {
  const t = Math.max(0, Math.min(1, util));
  // Blue (0x3b82f6) → Amber (0xfbbf24) at 0.5 → Red (0xef4444)
  const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
  if (t <= 0.5) {
    const k = t / 0.5;
    const r = lerp(0x3b, 0xfb, k);
    const g = lerp(0x82, 0xbf, k);
    const b = lerp(0xf6, 0x24, k);
    return (r << 16) | (g << 8) | b;
  }
  const k = (t - 0.5) / 0.5;
  const r = lerp(0xfb, 0xef, k);
  const g = lerp(0xbf, 0x44, k);
  const b = lerp(0x24, 0x44, k);
  return (r << 16) | (g << 8) | b;
}

/** Rebuild the heatmap layer from the current stations. Cheap enough
 *  that a full rebuild per scene msg beats a per-tile diff. */
function syncHeatmap(stations: readonly RenderStation[]): void {
  if (!heatmapLayer) return;
  heatmapLayer.removeChildren();
  const halfW = TILE_WIDTH / 2;
  const halfH = TILE_HEIGHT / 2;
  for (const s of stations) {
    if (s.utilization === undefined) continue;
    const center = worldToScreen({ x: s.x, y: s.y, z: s.z });
    const g = new Graphics();
    g.moveTo(center.sx, center.sy - halfH)
      .lineTo(center.sx + halfW, center.sy)
      .lineTo(center.sx, center.sy + halfH)
      .lineTo(center.sx - halfW, center.sy)
      .closePath()
      .fill({ color: heatColorAt(s.utilization), alpha: 0.55 });
    heatmapLayer.addChild(g);
  }
}

function handleScene(msg: Extract<MainToWorker, { kind: "scene" }>): void {
  if (!appReady || !app || !stationLayer || !edgeLayer) return;
  try {
    // VROL-856 — remember the scrubber time so advanceTrails renders
    // dots deterministically. undefined = auto-advance.
    simTimeMs = msg.simTimeMs ?? null;
    // VROL-237 — heatmap visibility follows the msg. When flipping
    // OFF, syncHeatmap does the tile teardown implicitly via
    // removeChildren next time it runs.
    if (msg.heatmap !== undefined && heatmapLayer) {
      heatmapVisible = msg.heatmap;
      heatmapLayer.visible = heatmapVisible;
    }
    // Drop placeholder on first real scene.
    const placeholder = app.stage.getChildByLabel("placeholder", true);
    if (placeholder) placeholder.removeFromParent();

    // Cache projected screen positions + state so the edge pass can
    // connect line endpoints without re-projecting and can freeze the
    // dot trail when the source is Down (VROL-207).
    const positions = new Map<string, { x: number; y: number }>();
    const states = new Map<string, RenderStation["state"]>();
    const seenStations = new Set<string>();
    for (const s of msg.stations) {
      const screen = worldToScreen({ x: s.x, y: s.y, z: s.z });
      positions.set(s.id, { x: screen.sx, y: screen.sy });
      states.set(s.id, s.state);
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

    // VROL-237 — rebuild heatmap tiles from the current stations. Cheap
    // enough at scenario scale that a full rebuild beats a diff.
    if (heatmapVisible) syncHeatmap(msg.stations);

    // Edges — simpler full rebuild for now; render is cheap when the count
    // is in the dozens and a diff-pass adds complexity without payoff.
    for (const g of edgeNodes.values()) g.removeFromParent();
    edgeNodes.clear();
    // VROL-933 — track which edges were in this scene so we can prune
    // sprite trails for any edges that left the scene.
    const seenEdges = new Set<string>();
    for (const e of msg.edges) {
      const a = positions.get(e.sourceId);
      const b = positions.get(e.targetId);
      if (!a || !b) continue;
      const g = drawEdge(e, a, b);
      edgeLayer.addChild(g);
      edgeNodes.set(e.id, g);
      seenEdges.add(e.id);
      // VROL-207 — freeze the trail when the source station is Down
      // so parts on the belt stop mid-flight instead of continuing.
      const frozen = states.get(e.sourceId) === "down";
      syncTrail(e.id, e.flowRate, frozen, a, b);
    }
    for (const id of [...edgeTrails.keys()]) {
      if (seenEdges.has(id)) continue;
      const trail = edgeTrails.get(id);
      if (!trail) continue;
      for (const d of trail.dots) d.removeFromParent();
      edgeTrails.delete(id);
    }

    // VROL-212 — workers. Optional in the scene msg; when omitted the
    // existing worker sprites persist (compatibility with old callers).
    if (msg.workers) {
      const seenWorkers = new Set<string>();
      for (const w of msg.workers) {
        upsertWorker(w);
        seenWorkers.add(w.id);
      }
      for (const [id, node] of workerNodes) {
        if (seenWorkers.has(id)) continue;
        node.container.removeFromParent();
        workerNodes.delete(id);
      }
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
  dotLayer = null;
  floorLayer = null;
  workerLayer = null;
  heatmapLayer = null;
  heatmapVisible = false;
  stationNodes.clear();
  edgeNodes.clear();
  edgeTrails.clear();
  workerNodes.clear();
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
