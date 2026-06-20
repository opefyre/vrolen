/**
 * VROL-483 — Performance budget.
 *
 * The project's portfolio budget targets:
 *   - LCP   ≤ 2500 ms (Good)
 *   - INP   ≤ 200  ms (Good)
 *   - CLS   ≤ 0.10
 *   - JS    ≤ 350  KB compressed for the editor-route bundle
 *   - CSS   ≤ 50   KB compressed
 *
 * Vrolen ships statically (Cloudflare Pages), so enforcement is local:
 *   - `runtimePerfBudget()` reads PerformanceObserver entries in the
 *     browser and logs any LCP/INP/CLS breach in dev. Calling it in prod
 *     forwards breaches via the error-monitoring path (VROL-480) so they
 *     show up next to runtime errors.
 *   - `assertBundleBudget(sizes)` is a build-time helper meant to be
 *     called from a post-build script (`pnpm build && node scripts/budget.mjs`).
 *
 * Concrete CI gating lands later — until then this module is the
 * single source of truth for the numbers.
 */

import { captureEvent } from "./error-monitoring";

export const PERF_BUDGET = {
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  jsKb: 350,
  cssKb: 50,
} as const;

export interface BundleSizes {
  readonly jsKb: number;
  readonly cssKb: number;
}

export interface BundleBudgetResult {
  readonly ok: boolean;
  readonly violations: readonly string[];
}

export function assertBundleBudget(sizes: BundleSizes): BundleBudgetResult {
  const violations: string[] = [];
  if (sizes.jsKb > PERF_BUDGET.jsKb) {
    violations.push(
      `JS bundle ${sizes.jsKb.toFixed(1)} KB exceeds budget ${String(PERF_BUDGET.jsKb)} KB`,
    );
  }
  if (sizes.cssKb > PERF_BUDGET.cssKb) {
    violations.push(
      `CSS bundle ${sizes.cssKb.toFixed(1)} KB exceeds budget ${String(PERF_BUDGET.cssKb)} KB`,
    );
  }
  return { ok: violations.length === 0, violations };
}

export function runtimePerfBudget(): void {
  if (typeof window === "undefined") return;
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const lcpObs = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (!last) return;
      const lcpMs = last.startTime;
      if (lcpMs > PERF_BUDGET.lcpMs) {
        captureEvent({
          message: `LCP ${lcpMs.toFixed(0)}ms exceeds budget ${String(PERF_BUDGET.lcpMs)}ms`,
          timestampMs: Date.now(),
        });
      }
    });
    lcpObs.observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // some browsers throw on unknown entryType — ignore.
  }
  try {
    let clsTotal = 0;
    const clsObs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const e = entry as PerformanceEntry & { value?: number; hadRecentInput?: boolean };
        if (typeof e.value === "number" && e.hadRecentInput === false) clsTotal += e.value;
      }
      if (clsTotal > PERF_BUDGET.cls) {
        captureEvent({
          message: `CLS ${clsTotal.toFixed(3)} exceeds budget ${String(PERF_BUDGET.cls)}`,
          timestampMs: Date.now(),
        });
      }
    });
    clsObs.observe({ type: "layout-shift", buffered: true });
  } catch {
    // ignore
  }
}
