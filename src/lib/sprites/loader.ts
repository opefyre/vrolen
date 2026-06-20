/**
 * VROL-255 — Sprite loader + cache.
 *
 * The visualizer (E06) calls `loadAtlas(manifestUrl)` once on startup;
 * the loader fetches the manifest JSON + the atlas PNG, decodes the
 * image into an HTMLImageElement (or ImageBitmap if available), and
 * returns a hot read-only handle the renderer queries by sprite id.
 *
 * Cache is in-memory keyed by manifest URL so subsequent loads of the
 * same atlas in the session are free. Falls back gracefully if a
 * sprite id is requested before the atlas is ready — returns null and
 * lets the caller render a placeholder.
 */

import { SpriteSpecSchema, type SpriteSpec } from "./spec";
import type { AtlasRect } from "./atlas";

export interface AtlasManifest {
  readonly atlas: string;
  readonly width: number;
  readonly height: number;
  readonly sprites: readonly SpriteSpec[];
  readonly rects: readonly AtlasRect[];
}

export interface LoadedAtlas {
  readonly image: HTMLImageElement | ImageBitmap;
  readonly manifest: AtlasManifest;
  /** Map sprite id → { spec, rect } so the renderer doesn't re-scan arrays. */
  readonly byId: ReadonlyMap<string, { readonly spec: SpriteSpec; readonly rect: AtlasRect }>;
}

const cache = new Map<string, Promise<LoadedAtlas>>();

export function _clearLoaderCacheForTests(): void {
  cache.clear();
}

async function fetchImage(src: string): Promise<HTMLImageElement | ImageBitmap> {
  // Prefer ImageBitmap (works off-thread, plays nicely with OffscreenCanvas).
  if (typeof createImageBitmap === "function" && typeof fetch === "function") {
    const res = await fetch(src);
    if (res.ok) {
      const blob = await res.blob();
      return createImageBitmap(blob);
    }
  }
  // Fallback: HTMLImageElement.
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      resolve(img);
    };
    img.onerror = () => {
      reject(new Error(`Failed to load sprite atlas image: ${src}`));
    };
    img.src = src;
  });
}

export async function loadAtlas(manifestUrl: string): Promise<LoadedAtlas> {
  const cached = cache.get(manifestUrl);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(manifestUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch atlas manifest: ${manifestUrl} (${String(res.status)})`);
    }
    const raw = (await res.json()) as unknown;
    if (!raw || typeof raw !== "object") {
      throw new Error("Atlas manifest is not an object");
    }
    const m = raw as AtlasManifest;
    const sprites = (m.sprites ?? []).map((s) => SpriteSpecSchema.parse(s));
    const image = await fetchImage(m.atlas);
    const byId = new Map<string, { spec: SpriteSpec; rect: AtlasRect }>();
    for (const spec of sprites) {
      const rect = m.rects.find((r) => r.id === spec.id);
      if (rect) byId.set(spec.id, { spec, rect });
    }
    return { image, manifest: { ...m, sprites }, byId };
  })();
  cache.set(manifestUrl, promise);
  return promise;
}
