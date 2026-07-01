/**
 * VROL-195 — sprite atlas loader.
 *
 * Pipeline strategy:
 *   1. `scripts/build-sprite-atlas.mjs` (build-time) scans `public/sprites/`
 *      for PNGs and emits a `public/sprites/manifest.json` mapping sprite
 *      names → file URLs. When the folder is empty (the POC state today)
 *      the script no-ops gracefully so the build still succeeds.
 *   2. This module loads the manifest at app start (inside the render
 *      worker), registers each entry with PixiJS Assets, and exposes
 *      `getSprite(name)`. `Sprite.from('machine-idle')` resolves to the
 *      correct texture.
 *   3. Until real art lands, `buildPlaceholderAtlas()` creates a small set
 *      of solid-colour placeholder textures so the demo renders SOMETHING
 *      for each station type. The placeholder set is intentionally tiny —
 *      it's a stop-gap, not the final palette.
 *
 * Atlas budget: 4096×4096 max per the engine spec (covers ~95% of GPUs).
 * Real-art builds should pack into a single PNG for one texture upload.
 */

import { Application, Cache, Graphics, RenderTexture, Texture } from "pixi.js";
// VROL-1195 — Pixi v8 renamed the Texture cache from Texture.addToCache
// (v7) to Cache.set (v8, moved into @pixi/assets under the Cache singleton).
// Same behaviour: subsequent `Sprite.from('machine-idle')` resolves via
// the cache. Also swapped Texture.fromURL (removed in v8) → Assets.load.
import { Assets } from "pixi.js";

/** Sprite names registered by the placeholder atlas (and the contract real
 *  art needs to keep). Keep in lockstep with the StationType enum. */
export const PLACEHOLDER_SPRITE_NAMES = [
  "machine-idle",
  "machine-running",
  "machine-down",
  "machine-blocked",
  "machine-starved",
  "machine-setup",
  "buffer",
  "source",
  "sink",
] as const;

export type PlaceholderSpriteName = (typeof PLACEHOLDER_SPRITE_NAMES)[number];

/** State → placeholder fill colour. Mirrors the canvas state palette. */
const PLACEHOLDER_FILL: Record<PlaceholderSpriteName, number> = {
  "machine-idle": 0x9ca3af,
  "machine-running": 0x22c55e,
  "machine-down": 0xef4444,
  "machine-blocked": 0xf97316,
  "machine-starved": 0xeab308,
  "machine-setup": 0x3b82f6,
  buffer: 0xe5e7eb,
  source: 0x8b5cf6,
  sink: 0x0ea5e9,
};

const PLACEHOLDER_SIZE = 80; // px — same logical size as the existing rect draws.

/**
 * Build placeholder textures for every PLACEHOLDER_SPRITE_NAMES entry by
 * rendering a roundRect into a RenderTexture, then register each with the
 * PixiJS Texture cache under its sprite name so `Sprite.from('machine-idle')`
 * resolves.
 *
 * Returns a Map for the caller to keep around (e.g. cache hits without
 * relying on the global Texture cache).
 */
export function buildPlaceholderAtlas(app: Application): Map<string, Texture> {
  const out = new Map<string, Texture>();
  for (const name of PLACEHOLDER_SPRITE_NAMES) {
    const g = new Graphics();
    g.roundRect(0, 0, PLACEHOLDER_SIZE, 32, 6)
      .fill({ color: PLACEHOLDER_FILL[name] })
      .stroke({ color: 0x111827, width: 1 });
    const texture = RenderTexture.create({
      width: PLACEHOLDER_SIZE,
      height: 32,
      resolution: app.renderer.resolution,
    });
    app.renderer.render({ container: g, target: texture });
    g.destroy();
    Cache.set(name, texture);
    out.set(name, texture);
  }
  return out;
}

/**
 * Load real sprite art from `public/sprites/manifest.json` when present.
 * Returns null when no manifest exists — caller should fall back to
 * `buildPlaceholderAtlas`. The manifest format matches the JSON emitted by
 * `scripts/build-sprite-atlas.mjs`.
 */
export async function loadManifestAtlas(): Promise<Map<string, Texture> | null> {
  try {
    const res = await fetch("/sprites/manifest.json");
    if (!res.ok) return null;
    const manifest = (await res.json()) as {
      readonly sprites: ReadonlyArray<{ readonly name: string; readonly src: string }>;
    };
    if (!Array.isArray(manifest.sprites) || manifest.sprites.length === 0) return null;
    const out = new Map<string, Texture>();
    for (const s of manifest.sprites) {
      // VROL-1195 — Pixi v8: use Assets.load rather than the removed
      // Texture.fromURL; register under a stable alias so `Sprite.from(name)`
      // resolves via the cache.
      const texture = (await Assets.load({ alias: s.name, src: s.src })) as Texture;
      Cache.set(s.name, texture);
      out.set(s.name, texture);
    }
    return out;
  } catch {
    return null;
  }
}
