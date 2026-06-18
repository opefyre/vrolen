import { describe, expect, it } from "vitest";

import { asMaterialId } from "./ids";
import { MaterialPool } from "./material-pool";

const BOTTLES = asMaterialId("bottles");
const CAPS = asMaterialId("caps");
const LABELS = asMaterialId("labels");

describe("MaterialPool — quantities", () => {
  it("rejects negative initial quantity", () => {
    expect(() => new MaterialPool([[BOTTLES, -1]])).toThrow();
  });

  it("returns 0 for materials never set", () => {
    const pool = new MaterialPool();
    expect(pool.quantity(BOTTLES)).toBe(0);
  });

  it("returns initial quantity", () => {
    const pool = new MaterialPool([[BOTTLES, 100]]);
    expect(pool.quantity(BOTTLES)).toBe(100);
  });
});

describe("MaterialPool — consume (atomic)", () => {
  it("returns true and deducts when all requirements are met", () => {
    const pool = new MaterialPool([
      [BOTTLES, 100],
      [CAPS, 100],
    ]);
    const ok = pool.consume([
      { materialId: BOTTLES, qtyPerPart: 1 },
      { materialId: CAPS, qtyPerPart: 1 },
    ]);
    expect(ok).toBe(true);
    expect(pool.quantity(BOTTLES)).toBe(99);
    expect(pool.quantity(CAPS)).toBe(99);
  });

  it("returns false and deducts NOTHING when any requirement is short", () => {
    const pool = new MaterialPool([
      [BOTTLES, 1],
      [CAPS, 100],
    ]);
    const ok = pool.consume([
      { materialId: BOTTLES, qtyPerPart: 2 },
      { materialId: CAPS, qtyPerPart: 1 },
    ]);
    expect(ok).toBe(false);
    // No partial deduction
    expect(pool.quantity(BOTTLES)).toBe(1);
    expect(pool.quantity(CAPS)).toBe(100);
  });

  it("treats empty requirement list as a trivial success", () => {
    const pool = new MaterialPool();
    expect(pool.consume([])).toBe(true);
  });
});

describe("MaterialPool — replenish", () => {
  it("adds to existing quantity", () => {
    const pool = new MaterialPool([[BOTTLES, 50]]);
    pool.replenish(BOTTLES, 100);
    expect(pool.quantity(BOTTLES)).toBe(150);
  });

  it("rejects negative replenishment amount", () => {
    const pool = new MaterialPool();
    expect(() => {
      pool.replenish(BOTTLES, -5);
    }).toThrow();
  });

  it("can replenish a previously-unknown material id", () => {
    const pool = new MaterialPool();
    pool.replenish(LABELS, 200);
    expect(pool.quantity(LABELS)).toBe(200);
  });
});

describe("MaterialPool — runway prediction", () => {
  it("returns null when no rates are positive", () => {
    const pool = new MaterialPool([[BOTTLES, 100]]);
    expect(pool.firstToDeplete(new Map([[BOTTLES, 0]]))).toBeNull();
  });

  it("predicts depletion time within tolerance on a known fixture", () => {
    // 1000 bottles consumed at 1/sec → 1000 seconds = 1,000,000 ms runway
    const pool = new MaterialPool([[BOTTLES, 1000]]);
    const rates = new Map([[BOTTLES, 1 / 1000]]); // 1 unit per 1000 ms
    const result = pool.firstToDeplete(rates);
    expect(result?.materialId).toBe(BOTTLES);
    expect(result?.runwayMs).toBe(1_000_000);
  });

  it("returns the material that will deplete FIRST", () => {
    const pool = new MaterialPool([
      [BOTTLES, 100], // at rate 1/ms = 100 ms runway
      [CAPS, 50], // at rate 1/ms = 50 ms runway — first to go
    ]);
    const rates = new Map([
      [BOTTLES, 1],
      [CAPS, 1],
    ]);
    const result = pool.firstToDeplete(rates);
    expect(result?.materialId).toBe(CAPS);
    expect(result?.runwayMs).toBe(50);
  });
});
