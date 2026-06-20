import { describe, expect, it } from "vitest";

import { activeFrame, DEFAULT_ANCHOR, FLOOR_TILE, SpriteSpecSchema } from "./spec";

describe("Sprite spec (VROL-245)", () => {
  it("validates a minimal spec + supplies default anchor + frames", () => {
    const s = SpriteSpecSchema.parse({
      id: "test",
      width: 32,
      height: 32,
      source: "kenney_industrial-kit",
    });
    expect(s.anchor).toEqual(DEFAULT_ANCHOR);
    expect(s.frames).toBe(1);
    expect(s.frameMs).toBe(120);
    expect(s.tags).toEqual([]);
  });

  it("rejects zero or negative dimensions", () => {
    expect(() => SpriteSpecSchema.parse({ id: "x", width: 0, height: 8, source: "t" })).toThrow();
    expect(() => SpriteSpecSchema.parse({ id: "x", width: 8, height: -1, source: "t" })).toThrow();
  });

  it("activeFrame is 0 for static sprites", () => {
    const s = SpriteSpecSchema.parse({ id: "x", width: 8, height: 8, source: "t" });
    expect(activeFrame(s, 0)).toBe(0);
    expect(activeFrame(s, 9999)).toBe(0);
  });

  it("activeFrame cycles through frames at frameMs cadence", () => {
    const s = SpriteSpecSchema.parse({
      id: "x",
      width: 8,
      height: 8,
      source: "t",
      frames: 3,
      frameMs: 100,
    });
    expect(activeFrame(s, 0)).toBe(0);
    expect(activeFrame(s, 100)).toBe(1);
    expect(activeFrame(s, 200)).toBe(2);
    expect(activeFrame(s, 300)).toBe(0);
  });

  it("FLOOR_TILE is the canonical isometric diamond size", () => {
    expect(FLOOR_TILE.width).toBe(64);
    expect(FLOOR_TILE.height).toBe(32);
  });
});
