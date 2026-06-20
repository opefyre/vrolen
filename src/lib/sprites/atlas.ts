/**
 * VROL-252 — Sprite atlas builder.
 *
 * In the visualizer pipeline, the atlas is a single PNG packed with
 * every sprite + a JSON manifest that maps sprite id → atlas rect. The
 * actual packing happens offline (`scripts/build-atlas.mjs` will use a
 * stock packer once it lands); this module is the runtime + test-friendly
 * implementation of the same shape so we can validate atlases in unit
 * tests without forking a Node binary.
 *
 * Algorithm: simple shelf packer. Sort sprites by height desc, lay them
 * left-to-right; if the next sprite doesn't fit on the current shelf,
 * start a new shelf below. Returns the atlas dimensions + sprite rects.
 */

import type { SpriteSpec } from "./spec";

export interface AtlasRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PackedAtlas {
  readonly width: number;
  readonly height: number;
  readonly rects: readonly AtlasRect[];
}

export interface PackOptions {
  /** Padding between sprites in atlas pixels. Default 1 (avoids bleed). */
  readonly padding?: number;
  /** Atlas width cap. Default 1024. */
  readonly maxWidth?: number;
}

export function packAtlas(sprites: readonly SpriteSpec[], options: PackOptions = {}): PackedAtlas {
  const padding = options.padding ?? 1;
  const maxWidth = options.maxWidth ?? 1024;
  // Sort by height desc, breaking ties by width desc — bigger first
  // packs tighter than naïve order.
  const sorted = [...sprites].sort((a, b) => b.height - a.height || b.width - a.width);
  const rects: AtlasRect[] = [];
  let shelfY = padding;
  let shelfX = padding;
  let shelfHeight = 0;
  let atlasWidth = 0;
  for (const s of sorted) {
    const w = s.width;
    const h = s.height;
    // Start a new shelf if this sprite doesn't fit on the current one.
    if (shelfX + w + padding > maxWidth) {
      shelfY += shelfHeight + padding;
      shelfX = padding;
      shelfHeight = 0;
    }
    rects.push({ id: s.id, x: shelfX, y: shelfY, width: w, height: h });
    shelfX += w + padding;
    shelfHeight = Math.max(shelfHeight, h);
    atlasWidth = Math.max(atlasWidth, shelfX);
  }
  const atlasHeight = shelfY + shelfHeight + padding;
  return {
    width: nextPow2(atlasWidth),
    height: nextPow2(atlasHeight),
    rects,
  };
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}
