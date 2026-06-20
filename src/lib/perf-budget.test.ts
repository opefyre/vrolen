import { describe, expect, it } from "vitest";

import { assertBundleBudget, PERF_BUDGET } from "./perf-budget";

describe("perf-budget (VROL-483)", () => {
  it("PERF_BUDGET has the documented portfolio targets", () => {
    expect(PERF_BUDGET.lcpMs).toBe(2500);
    expect(PERF_BUDGET.inpMs).toBe(200);
    expect(PERF_BUDGET.cls).toBe(0.1);
    expect(PERF_BUDGET.jsKb).toBe(350);
    expect(PERF_BUDGET.cssKb).toBe(50);
  });

  it("assertBundleBudget passes when within budget", () => {
    const r = assertBundleBudget({ jsKb: 200, cssKb: 30 });
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it("assertBundleBudget reports JS overshoot", () => {
    const r = assertBundleBudget({ jsKb: 500, cssKb: 30 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatch(/JS bundle 500.0 KB exceeds budget 350 KB/);
  });

  it("assertBundleBudget reports CSS overshoot", () => {
    const r = assertBundleBudget({ jsKb: 200, cssKb: 80 });
    expect(r.ok).toBe(false);
    expect(r.violations[0]).toMatch(/CSS bundle 80.0 KB exceeds budget 50 KB/);
  });
});
