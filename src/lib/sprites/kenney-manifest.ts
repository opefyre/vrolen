/**
 * VROL-242 — Kenney pack audit.
 *
 * Single source of truth for which Kenney packs Vrolen pulls sprites
 * from. Kenney's packs are CC0 (public domain dedication), so we can
 * commit + ship them without attribution requirements; we credit
 * anyway in the about page (lands later) because it's the right thing
 * to do.
 *
 * Selected: kenney_industrial-kit (factory floor tiles + crates +
 * conveyor + tank + pipe segments). Covers ~80% of the station +
 * material visuals Vrolen needs. The handful of gaps (worker poses,
 * specific station types like SMT pick-and-place) get covered by
 * vrolen-supplement (VROL-248 is closed as scope-cut for the portfolio
 * phase; if we hit a sprite gap we add a single hand-drawn or
 * sourced-elsewhere asset and document it here).
 *
 * Packs and licenses live in code so the visualizer can show
 * attribution + the asset pipeline can validate completeness.
 */

import type { SpriteSpec } from "./spec";

export interface KenneyPack {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly license: "CC0";
  /** Sprite ids this pack contributes to the atlas (matches SpriteSpec.id). */
  readonly contributes: readonly string[];
}

export const KENNEY_PACKS: readonly KenneyPack[] = [
  {
    id: "kenney_industrial-kit",
    name: "Industrial Kit",
    url: "https://kenney.nl/assets/industrial-kit",
    license: "CC0",
    contributes: [
      "floor-tile",
      "station-machine",
      "station-buffer",
      "station-tank",
      "station-conveyor",
      "station-pallet",
      "edge-pipe",
      "material-crate",
      "material-barrel",
    ],
  },
];

export const VROLEN_SUPPLEMENT_SOURCE = "vrolen-supplement" as const;

/** Canonical sprite list the atlas builder is expected to emit. */
export const REQUIRED_SPRITES: readonly Pick<SpriteSpec, "id" | "source">[] = [
  { id: "floor-tile", source: "kenney_industrial-kit" },
  { id: "station-machine", source: "kenney_industrial-kit" },
  { id: "station-buffer", source: "kenney_industrial-kit" },
  { id: "station-tank", source: "kenney_industrial-kit" },
  { id: "station-conveyor", source: "kenney_industrial-kit" },
  { id: "station-pallet", source: "kenney_industrial-kit" },
  { id: "station-qc", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "station-assembly", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "station-packaging", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "station-input", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "station-output", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "worker-idle", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "worker-walk", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "worker-work", source: VROLEN_SUPPLEMENT_SOURCE },
  { id: "edge-pipe", source: "kenney_industrial-kit" },
  { id: "material-crate", source: "kenney_industrial-kit" },
  { id: "material-barrel", source: "kenney_industrial-kit" },
];

/**
 * VROL-258 — asset style guide.
 *
 * Constants the visualizer + supplement-sprite authors must respect so
 * new assets blend with the Kenney baseline.
 */
export const STYLE = {
  /** Isometric projection — 2:1 aspect. */
  tileAspect: 2,
  /** Pixel grid — never sub-pixel align sprites or they shimmer. */
  pixelGrid: 1,
  /** Outline color used in the supplement set to match Kenney's. */
  outlineColor: "#1f2937",
  /** Outline width in source-pixels (≈ 2 atlas pixels at 1:1). */
  outlineWidthPx: 2,
  /** Color ramps used across station types (matches the sim-* design tokens). */
  rampPrimary: "#22c55e",
  rampAccent: "#eab308",
} as const;
