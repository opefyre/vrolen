#!/usr/bin/env node
/**
 * VROL-195 — sprite atlas build script.
 *
 * Scans `public/sprites/` for PNG files and emits `public/sprites/manifest.json`
 * listing each sprite's name + relative URL. Runtime loader in
 * `src/render/sprite-atlas.ts` consumes this manifest via Pixi Assets.
 *
 * No-op behaviour:
 *   - No `public/sprites/` directory  →  log "no source sprites; skipping"
 *   - Directory exists but is empty   →  emit an empty manifest, log skip
 * In either case the build still succeeds. The runtime loader gracefully
 * falls back to placeholder textures from `buildPlaceholderAtlas()`.
 *
 * Future work (not in scope here): pack all source PNGs into a single
 * atlas.png + atlas.json using a real binpacker (texture-packer / @pixi/spritesheet)
 * for a one-upload texture vs N-upload manifest. Today's POC doesn't have
 * the PNG count to justify the packer dep.
 */
import { readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";

const SPRITES_DIR = resolve(import.meta.dirname, "..", "public", "sprites");
const MANIFEST_PATH = resolve(SPRITES_DIR, "manifest.json");

async function main() {
  let entries;
  try {
    const s = await stat(SPRITES_DIR);
    if (!s.isDirectory()) {
      console.log("[build-sprite-atlas] public/sprites is not a directory — skipping");
      return;
    }
    entries = await readdir(SPRITES_DIR);
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") {
      // Folder doesn't exist yet — create it so the runtime fetch doesn't 404
      // every page load, then emit an empty manifest. Easier than a try/catch
      // tower on the client.
      await mkdir(SPRITES_DIR, { recursive: true });
      await writeFile(MANIFEST_PATH, JSON.stringify({ sprites: [] }, null, 2) + "\n");
      console.log(
        "[build-sprite-atlas] public/sprites/ was missing — created an empty manifest. Drop PNGs in and re-run.",
      );
      return;
    }
    throw err;
  }
  const pngs = entries.filter((f) => extname(f).toLowerCase() === ".png");
  const sprites = pngs.map((f) => ({
    name: basename(f, extname(f)),
    src: `/sprites/${f}`,
  }));
  await writeFile(
    MANIFEST_PATH,
    JSON.stringify({ sprites }, null, 2) + "\n",
  );
  console.log(
    `[build-sprite-atlas] manifest with ${String(sprites.length)} sprite${sprites.length === 1 ? "" : "s"} written to public/sprites/manifest.json`,
  );
}

main().catch((err) => {
  console.error("[build-sprite-atlas]", err);
  process.exit(1);
});
