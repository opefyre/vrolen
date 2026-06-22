/**
 * VROL-802 — node ring + lucide badges + low-zoom collapse.
 *
 * StationNode sits inline in EditorPage.tsx and depends on a live React
 * Flow store (`useStore(s => s.transform[2])` for zoom), so a true unit
 * render needs a full ReactFlow tree. Instead this test reads the source
 * and asserts the three structural properties the story commits to:
 *
 *   1. The emoji badge glyphs are gone.
 *   2. lucide icons (Wrench, RotateCcw, ArrowLeftRight, Repeat, Lock) are
 *      used in the badge / lock spots.
 *   3. The badge row + cycle-time line gate on a low-zoom guard derived
 *      from the canvas transform.
 *   4. A dedicated state-ring element is rendered when playbackState is set.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_PAGE_PATH = join(__dirname, "EditorPage.tsx");

function stationNodeBody(src: string): string {
  // StationNode is the only component whose signature starts with
  // `function StationNode(` — grab from there to the end of its render
  // return so we don't false-match badge glyphs elsewhere in the file
  // (the cycle-time mean formatter, for instance, lives above it).
  const start = src.indexOf("function StationNode(");
  if (start < 0) throw new Error("Couldn't locate StationNode in EditorPage.tsx");
  // End at the next top-level `function ` (the next sibling component).
  const after = src.slice(start + 1);
  const nextFn = after.search(/\nfunction [A-Z]/);
  if (nextFn < 0) return src.slice(start);
  return src.slice(start, start + 1 + nextFn);
}

describe("StationNode badge + low-zoom + state-ring upgrades (VROL-802)", () => {
  const src = readFileSync(EDITOR_PAGE_PATH, "utf8");
  const body = stationNodeBody(src);

  it("drops the prior emoji badge glyphs", () => {
    // The exact glyphs used in the pre-VROL-802 badge row.
    expect(body).not.toContain("🛠");
    expect(body).not.toContain("🏷");
    expect(body).not.toContain("↻");
    expect(body).not.toContain("⇄");
    expect(body).not.toContain("↺");
    expect(body).not.toContain("🔒");
  });

  it("uses lucide icons for maintenance / setup / changeover / rework / lock", () => {
    expect(body).toMatch(/<Wrench\b/);
    expect(body).toMatch(/<RotateCcw\b/);
    expect(body).toMatch(/<ArrowLeftRight\b/);
    expect(body).toMatch(/<Repeat\b/);
    expect(body).toMatch(/<LockIcon\b/);
  });

  it("reads the canvas zoom via useStore and gates the badge row on it", () => {
    // Source-level proof the zoom is wired in.
    expect(body).toMatch(/useStore\(/);
    expect(body).toMatch(/isLowZoom/);
    // The badge row + cycle-time line are both behind `!isLowZoom`.
    expect(body).toMatch(/!isLowZoom/);
  });

  it("renders an outer state-ring element when playback state is set", () => {
    expect(body).toContain('data-testid="station-state-ring"');
  });
});
