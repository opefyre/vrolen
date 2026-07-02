/**
 * Main thread ⇄ render worker message protocol (VROL-187).
 *
 * Discriminated unions so both sides get exhaustive type-checking on each
 * `kind`. Keep payloads serializable — no functions, no Class instances,
 * no Maps/Sets in the wire format (PixiJS objects stay inside the worker).
 *
 * The OffscreenCanvas itself is the one Transferable that crosses the
 * boundary, in the `init` message.
 */

/**
 * VROL-1228 — node "type" from the domain model, projected into the
 * render layer so the worker can draw a type-distinct sprite per
 * station (mixer vs filler vs capper etc.) instead of the generic
 * grey box every entry used to render as. Values mirror the react-flow
 * node.type strings authored in the editor. Unknown / missing values
 * fall through to a generic sprite so brand-new node types don't
 * crash rendering.
 */
export type RenderStationType =
  | "mixer"
  | "filler"
  | "capper"
  | "qc"
  | "labeler"
  | "packer"
  | "conveyor"
  | "manual"
  | "machine"
  | "buffer"
  | "assembly"
  | "transport"
  | "source"
  | "sink"
  | "generic";

/** Renderer-side state for a single station node, as projected from the
 *  domain model. The render layer doesn't know about react-flow nodes;
 *  EditorPage will map between the two before posting. */
export interface RenderStation {
  readonly id: string;
  /** World-space tile coords (NOT pixels). Renderer converts via projection. */
  readonly x: number;
  readonly y: number;
  /** Stack offset (0 = floor, 1 = elevated, etc). Used for depth sort. */
  readonly z: number;
  readonly label: string;
  /** Coarse engine state — drives the ring/tint colour. */
  readonly state: "idle" | "running" | "blocked" | "starved" | "down" | "setup";
  /** Bottleneck flag → ring highlight. */
  readonly isBottleneck: boolean;
  /** VROL-237 — utilization 0..1 for the heatmap overlay. Optional so
   *  callers without a run don't need to fabricate a value. */
  readonly utilization?: number;
  /** VROL-1228 — node type so the worker can draw a type-distinct
   *  sprite. Optional for wire-compat with older scenes; missing
   *  values fall through to the generic sprite. */
  readonly nodeType?: RenderStationType;
}

export interface RenderEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  /** Parts/hour from the last run, for flow-dot animation intensity. */
  readonly flowRate: number;
}

/**
 * VROL-212 — one worker on the floor. Position is tile-space, same
 * as RenderStation. Palette indexes into WORKER_PALETTES for a colour
 * (proxy for skill group until real skill data feeds in).
 */
export interface RenderWorker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** idle = subtle bob, working = at station, walking = between two stations. */
  readonly mode: "idle" | "working" | "walking";
  /** Colour palette index — differentiates skill groups visually. */
  readonly palette: number;
  /** Optional label overlay (name / role). */
  readonly label?: string;
}

/** Main → worker messages. */
export type MainToWorker =
  | {
      kind: "init";
      /** Transferred — main thread loses access after post. */
      canvas: OffscreenCanvas;
      /** Initial logical canvas size in CSS px. */
      width: number;
      height: number;
      /** devicePixelRatio at init time. */
      dpr: number;
    }
  | { kind: "resize"; width: number; height: number; dpr: number }
  | {
      kind: "scene";
      stations: readonly RenderStation[];
      edges: readonly RenderEdge[];
      /**
       * VROL-856 — playback scrubber time in ms. When present, edge dots
       * position deterministically from (simTimeMs * flowRate + i / N),
       * so scrubbing backwards/jumping snaps to a reproducible position.
       * Absent = auto-advance at 60fps (default demo behaviour).
       */
      simTimeMs?: number;
      /** VROL-212 — optional worker layer. Absent = don't touch existing
       *  worker sprites (compatible with older callers). */
      workers?: readonly RenderWorker[];
      /** VROL-237 — utilization heatmap toggle. When true, tile-under-
       *  station tint scales with utilization: 0 → cool blue, 1 → hot red. */
      heatmap?: boolean;
    }
  | { kind: "camera"; x: number; y: number; zoom: number }
  | { kind: "dispose" };

/** Worker → main messages. */
export type WorkerToMain =
  | { kind: "ready"; pixiVersion: string }
  | {
      kind: "error";
      stage: "init" | "resize" | "scene" | "camera" | "render";
      message: string;
    }
  | { kind: "fps"; fps: number; frameCount: number };

/** Type-guard helpers used on the worker side. */
export function isMainToWorker(value: unknown): value is MainToWorker {
  if (!value || typeof value !== "object") return false;
  const k = (value as { kind?: unknown }).kind;
  return k === "init" || k === "resize" || k === "scene" || k === "camera" || k === "dispose";
}
