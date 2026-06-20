import { describe, expect, it } from "vitest";

import { evaluateCustomKpi } from "./custom-kpi";

describe("evaluateCustomKpi (VROL-82)", () => {
  it("evaluates a simple ratio", () => {
    expect(evaluateCustomKpi("good / total", { good: 90, total: 100 })).toBeCloseTo(0.9);
  });

  it("respects operator precedence", () => {
    expect(evaluateCustomKpi("a + b * c", { a: 1, b: 2, c: 3 })).toBe(7);
  });

  it("respects parentheses", () => {
    expect(evaluateCustomKpi("(a + b) * c", { a: 1, b: 2, c: 3 })).toBe(9);
  });

  it("handles numeric literals", () => {
    expect(evaluateCustomKpi("oee * 100", { oee: 0.75 })).toBe(75);
  });

  it("returns NaN when identifier is unknown", () => {
    expect(Number.isNaN(evaluateCustomKpi("missing", {}))).toBe(true);
  });

  it("returns NaN on divide-by-zero", () => {
    expect(Number.isNaN(evaluateCustomKpi("a / b", { a: 1, b: 0 }))).toBe(true);
  });

  it("returns NaN on malformed input", () => {
    expect(Number.isNaN(evaluateCustomKpi("a +", { a: 1 }))).toBe(true);
    expect(Number.isNaN(evaluateCustomKpi("(a + b", { a: 1, b: 2 }))).toBe(true);
  });

  it("rejects function calls + property access (whitelisted operators only)", () => {
    expect(Number.isNaN(evaluateCustomKpi("Math.abs(a)", { a: 1 }))).toBe(true);
    expect(Number.isNaN(evaluateCustomKpi("a.b", { a: 1 }))).toBe(true);
  });
});
