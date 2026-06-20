import { describe, expect, it } from "vitest";

import { packAtlas } from "./atlas";
import { SpriteSpecSchema, type SpriteSpec } from "./spec";

function spec(id: string, w: number, h: number): SpriteSpec {
  return SpriteSpecSchema.parse({
    id,
    width: w,
    height: h,
    source: "test",
  });
}

describe("packAtlas (VROL-252)", () => {
  it("returns an empty atlas when given no sprites", () => {
    const a = packAtlas([]);
    expect(a.rects).toEqual([]);
    expect(a.width).toBeGreaterThan(0);
    expect(a.height).toBeGreaterThan(0);
  });

  it("packs rects without overlap", () => {
    const a = packAtlas([spec("a", 32, 32), spec("b", 32, 32), spec("c", 64, 16)]);
    expect(a.rects).toHaveLength(3);
    for (let i = 0; i < a.rects.length; i++) {
      for (let j = i + 1; j < a.rects.length; j++) {
        const r1 = a.rects[i]!;
        const r2 = a.rects[j]!;
        const overlap =
          r1.x < r2.x + r2.width &&
          r1.x + r1.width > r2.x &&
          r1.y < r2.y + r2.height &&
          r1.y + r1.height > r2.y;
        expect(overlap).toBe(false);
      }
    }
  });

  it("starts a new shelf when the next sprite doesn't fit", () => {
    const a = packAtlas([spec("a", 700, 32), spec("b", 700, 32)], { maxWidth: 1024 });
    const rects = a.rects;
    expect(rects[0]?.y).not.toBe(rects[1]?.y);
  });

  it("returns dimensions that are powers of two", () => {
    const a = packAtlas([spec("a", 64, 64), spec("b", 64, 64)]);
    const isPow2 = (n: number): boolean => (n & (n - 1)) === 0;
    expect(isPow2(a.width)).toBe(true);
    expect(isPow2(a.height)).toBe(true);
  });
});
