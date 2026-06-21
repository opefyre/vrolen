import { describe, expect, it } from "vitest";

import {
  IDENTITY_CAMERA,
  TILE_HEIGHT,
  TILE_WIDTH,
  depthKey,
  isPointInTile,
  screenToWorld,
  tileCorners,
  worldToScreen,
} from "./isometric";

const EPS = 1e-9;

describe("worldToScreen (VROL-191)", () => {
  it("origin → origin at identity camera, zoom 1", () => {
    const p = worldToScreen({ x: 0, y: 0 });
    expect(p.sx).toBeCloseTo(0, 10);
    expect(p.sy).toBeCloseTo(0, 10);
  });

  it("(1, 0) projects to (+halfW, +halfH)", () => {
    const p = worldToScreen({ x: 1, y: 0 });
    expect(p.sx).toBeCloseTo(TILE_WIDTH / 2, 10);
    expect(p.sy).toBeCloseTo(TILE_HEIGHT / 2, 10);
  });

  it("(0, 1) projects to (-halfW, +halfH)", () => {
    const p = worldToScreen({ x: 0, y: 1 });
    expect(p.sx).toBeCloseTo(-TILE_WIDTH / 2, 10);
    expect(p.sy).toBeCloseTo(TILE_HEIGHT / 2, 10);
  });

  it("z lifts the sprite upward by tileHeight * z", () => {
    const flat = worldToScreen({ x: 2, y: 3, z: 0 });
    const stacked = worldToScreen({ x: 2, y: 3, z: 1 });
    expect(stacked.sx).toBeCloseTo(flat.sx, 10);
    expect(stacked.sy).toBeCloseTo(flat.sy - TILE_HEIGHT, 10);
  });

  it("camera pan offsets the projection by (camX, camY)", () => {
    const a = worldToScreen({ x: 4, y: 7 }, { x: 100, y: 200, zoom: 1 });
    const b = worldToScreen({ x: 4, y: 7 }, IDENTITY_CAMERA);
    expect(a.sx - b.sx).toBeCloseTo(100, 10);
    expect(a.sy - b.sy).toBeCloseTo(200, 10);
  });

  it("camera zoom scales the half-tile size", () => {
    const a = worldToScreen({ x: 1, y: 0 }, { x: 0, y: 0, zoom: 2 });
    expect(a.sx).toBeCloseTo(TILE_WIDTH, 10);
    expect(a.sy).toBeCloseTo(TILE_HEIGHT, 10);
  });
});

describe("screenToWorld inverse", () => {
  it("round-trip (1000 random points) within float epsilon", () => {
    // Deterministic seed via Mulberry32 so the test isn't flaky.
    let s = 0xc0ffee;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < 1000; i++) {
      const x = (rand() - 0.5) * 200;
      const y = (rand() - 0.5) * 200;
      const camera = {
        x: (rand() - 0.5) * 400,
        y: (rand() - 0.5) * 400,
        zoom: 0.5 + rand() * 3,
      };
      const screen = worldToScreen({ x, y }, camera);
      const back = screenToWorld(screen, camera);
      expect(back.x).toBeCloseTo(x, 8);
      expect(back.y).toBeCloseTo(y, 8);
    }
  });

  it("round-trip works at identity camera too", () => {
    const cases = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -3, y: 7 },
      { x: 3.5, y: -2.25 },
    ];
    for (const c of cases) {
      const back = screenToWorld(worldToScreen(c));
      expect(back.x).toBeCloseTo(c.x, 10);
      expect(back.y).toBeCloseTo(c.y, 10);
    }
  });
});

describe("depthKey", () => {
  it("orders sprites with larger world.y on top", () => {
    expect(depthKey({ x: 0, y: 1 })).toBeGreaterThan(depthKey({ x: 0, y: 0 }));
  });

  it("breaks ties by world.x", () => {
    expect(depthKey({ x: 2, y: 5 })).toBeGreaterThan(depthKey({ x: 1, y: 5 }));
  });

  it("stacked sprite (z > 0) draws over the one beneath it", () => {
    expect(depthKey({ x: 1, y: 1, z: 1 })).toBeGreaterThan(depthKey({ x: 1, y: 1, z: 0 }));
  });
});

describe("tileCorners", () => {
  it("north + south are vertically opposite around the center", () => {
    const corners = tileCorners({ x: 0, y: 0 });
    expect(corners.north.sx).toBe(0);
    expect(corners.south.sx).toBe(0);
    expect(corners.north.sy).toBe(-TILE_HEIGHT / 2);
    expect(corners.south.sy).toBe(TILE_HEIGHT / 2);
  });

  it("east + west are horizontally opposite around the center", () => {
    const corners = tileCorners({ x: 0, y: 0 });
    expect(corners.east.sx).toBe(TILE_WIDTH / 2);
    expect(corners.west.sx).toBe(-TILE_WIDTH / 2);
  });
});

describe("isPointInTile", () => {
  it("centre of the tile is in the tile", () => {
    expect(isPointInTile({ sx: 0, sy: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it("the four corners are exactly on the boundary (inclusive)", () => {
    const corners = tileCorners({ x: 0, y: 0 });
    expect(isPointInTile(corners.north, { x: 0, y: 0 })).toBe(true);
    expect(isPointInTile(corners.south, { x: 0, y: 0 })).toBe(true);
    expect(isPointInTile(corners.east, { x: 0, y: 0 })).toBe(true);
    expect(isPointInTile(corners.west, { x: 0, y: 0 })).toBe(true);
  });

  it("a point well outside the diamond rejects", () => {
    expect(isPointInTile({ sx: TILE_WIDTH, sy: 0 }, { x: 0, y: 0 })).toBe(false);
    expect(isPointInTile({ sx: 0, sy: TILE_HEIGHT }, { x: 0, y: 0 })).toBe(false);
  });

  it("a point in an adjacent tile is NOT in this one", () => {
    // Centre of tile (1, 0)
    const adjCenter = worldToScreen({ x: 1, y: 0 });
    expect(isPointInTile(adjCenter, { x: 0, y: 0 })).toBe(false);
    expect(isPointInTile(adjCenter, { x: 1, y: 0 })).toBe(true);
  });

  it("respects camera zoom", () => {
    const cam = { x: 0, y: 0, zoom: 2 };
    // A point that's outside at zoom 1 but inside at zoom 2.
    const inside = { sx: TILE_WIDTH / 2 - EPS, sy: 0 };
    expect(isPointInTile(inside, { x: 0, y: 0 }, cam)).toBe(true);
  });
});
