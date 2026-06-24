/**
 * VROL-1001 — DelayedBuffer unit tests.
 */
import { describe, expect, it } from "vitest";

import { DelayedBuffer } from "./delayed-buffer";

describe("DelayedBuffer", () => {
  it("rejects invalid construction", () => {
    expect(() => new DelayedBuffer<number>(-1, 1000)).toThrow();
    expect(() => new DelayedBuffer<number>(2.5, 1000)).toThrow();
    expect(() => new DelayedBuffer<number>(2, -1)).toThrow();
    expect(() => new DelayedBuffer<number>(2, Number.NaN)).toThrow();
  });

  it("single part transits over residenceTimeMs", () => {
    const b = new DelayedBuffer<number>(2, 5_000);
    b.resetTracking(0);
    expect(b.pushAt(42, 0)).toBe(true);
    expect(b.size).toBe(1);
    // Not yet ready.
    expect(b.peekReady(0)).toBeUndefined();
    expect(b.peekReady(4_999)).toBeUndefined();
    expect(b.pullAt(4_999)).toBeUndefined();
    expect(b.size).toBe(1);
    // Becomes ready exactly at readyAtMs.
    expect(b.peekReady(5_000)).toBe(42);
    expect(b.pullAt(5_000)).toBe(42);
    expect(b.size).toBe(0);
    expect(b.firstReadyAt()).toBeUndefined();
  });

  it("multi-part interleave preserves FIFO + per-item delay", () => {
    const b = new DelayedBuffer<string>(4, 1_000);
    b.resetTracking(0);
    b.pushAt("a", 0);
    b.pushAt("b", 250);
    b.pushAt("c", 500);
    // At t=500: none ready (a needs t=1000).
    expect(b.readyCountAt(500)).toBe(0);
    expect(b.firstReadyAt()).toBe(1_000);
    // At t=1000: a ready.
    expect(b.readyCountAt(1_000)).toBe(1);
    expect(b.pullAt(1_000)).toBe("a");
    // Now front is b with readyAt=1250.
    expect(b.firstReadyAt()).toBe(1_250);
    expect(b.pullAt(1_250)).toBe("b");
    expect(b.pullAt(1_500)).toBe("c");
    expect(b.isEmpty).toBe(true);
  });

  it("respects capacity for back-pressure including in-transit items", () => {
    const b = new DelayedBuffer<number>(2, 1_000);
    b.resetTracking(0);
    expect(b.pushAt(1, 0)).toBe(true);
    expect(b.pushAt(2, 100)).toBe(true);
    // Full now — no item is ready yet but new pushes still rejected.
    expect(b.pushAt(3, 200)).toBe(false);
    expect(b.size).toBe(2);
    // After draining one, capacity opens up.
    expect(b.pullAt(1_000)).toBe(1);
    expect(b.pushAt(3, 1_000)).toBe(true);
  });

  it("computes time-weighted WIP integral", () => {
    const b = new DelayedBuffer<number>(5, 100);
    b.resetTracking(0);
    b.pushAt(1, 0); // size 1
    b.pushAt(2, 100); // size 2 (1 just became ready but still in buffer)
    // From 0..100: size 1 → contributes 100.
    // From 100..200: size 2 → contributes 200.
    b.pullAt(200); // pulls 1, size 1
    // From 200..300: size 1 → contributes 100.
    const avg = b.averageWIP(300);
    // Total integral = 100 + 200 + 100 = 400; elapsed = 300 → avg = 400/300.
    expect(avg).toBeCloseTo(400 / 300, 5);
  });

  it("residenceTimeMs = 0 behaves like a normal FIFO", () => {
    const b = new DelayedBuffer<number>(3, 0);
    b.resetTracking(0);
    b.pushAt(1, 100);
    expect(b.peekReady(100)).toBe(1);
    expect(b.pullAt(100)).toBe(1);
  });

  it("clear empties the buffer", () => {
    const b = new DelayedBuffer<number>(3, 1_000);
    b.resetTracking(0);
    b.pushAt(1, 0);
    b.pushAt(2, 100);
    b.clear();
    expect(b.size).toBe(0);
    expect(b.firstReadyAt()).toBeUndefined();
  });

  it("rejects backwards-time ticks", () => {
    const b = new DelayedBuffer<number>(2, 100);
    b.resetTracking(0);
    b.pushAt(1, 100);
    expect(() => b.pushAt(2, 50)).toThrow();
  });
});
