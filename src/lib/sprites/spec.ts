/**
 * VROL-245 — Sprite specification.
 *
 * Every sprite the visualizer (E06) renders conforms to this shape.
 * Hand-rolled Kenney imports + AI-supplement fills land in
 * `kenney-manifest.ts` and `manifest.json`; this module is the type +
 * validation surface they're checked against.
 *
 * Canonical dimensions: 64 wide × 32 tall for floor tiles (isometric
 * diamond), variable for stations / workers (anchored at the bottom-
 * center so they sit on the tile correctly). Frames are CCW from the
 * front-facing pose; idle = frame 0.
 */

import { z } from "zod";

export const SpriteAnchorSchema = z.object({
  /** Anchor X as a fraction of the sprite width (0–1). Default 0.5 = center. */
  x: z.number().min(0).max(1),
  /** Anchor Y as a fraction of the sprite height (0–1). Default 1 = bottom. */
  y: z.number().min(0).max(1),
});

export type SpriteAnchor = z.infer<typeof SpriteAnchorSchema>;

export const SpriteSpecSchema = z.object({
  /** Stable id. Used in the loader cache + sprite atlas mapping. */
  id: z.string().min(1),
  /** Width in atlas pixels. */
  width: z.number().int().positive(),
  /** Height in atlas pixels. */
  height: z.number().int().positive(),
  /** Anchor (0–1 normalised). Defaults to bottom-center. */
  anchor: SpriteAnchorSchema.default({ x: 0.5, y: 1 }),
  /** Frame count. 1 = static; >1 = animation. */
  frames: z.number().int().positive().default(1),
  /** Frame duration ms. Ignored when frames === 1. */
  frameMs: z.number().int().positive().default(120),
  /** Source pack (e.g. "kenney_industrial-kit") or "vrolen-supplement". */
  source: z.string().min(1),
  /** Tags for picker UI / heatmap binding (e.g. "station", "worker"). */
  tags: z.array(z.string()).default([]),
});

export type SpriteSpec = z.infer<typeof SpriteSpecSchema>;

/** Frame helper — returns the active frame index given a wall-clock ms. */
export function activeFrame(spec: SpriteSpec, nowMs: number): number {
  if (spec.frames === 1) return 0;
  return Math.floor(nowMs / spec.frameMs) % spec.frames;
}

/** Default anchor (bottom-center). */
export const DEFAULT_ANCHOR: SpriteAnchor = { x: 0.5, y: 1 };

/** Canonical floor tile dimensions (isometric diamond). */
export const FLOOR_TILE = { width: 64, height: 32 } as const;
