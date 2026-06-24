/**
 * VROL-1001 — Conveyor integration proof.
 *
 * Demonstrates a working conveyor primitive end-to-end by wiring
 * Scheduler + DelayedBuffer to model: upstream station pushes a part
 * every 1 s into a 5 s conveyor; downstream pulls parts as they
 * become ready. Verifies (a) the first part exits 5 s after entering,
 * (b) steady-state inter-arrival = 1 s, (c) capacity-bounded back-
 * pressure stalls the upstream when the conveyor fills.
 *
 * The chain-harness wiring (per-edge bufferDelayMs, downstream-wake
 * via scheduler event) is its own follow-up sprint. This test proves
 * the primitive is correct and documents the integration shape.
 */

import { describe, expect, it } from "vitest";

import { DelayedBuffer } from "./delayed-buffer";
import { Scheduler } from "./scheduler";

interface ConveyorEvent {
  readonly kind: "push" | "pull" | "ready-check";
  readonly partId?: number;
}

describe("DelayedBuffer + Scheduler integration (VROL-1001)", () => {
  it("models a 5s conveyor between a 1s producer and an eager consumer", () => {
    const conveyor = new DelayedBuffer<number>(100, 5_000);
    conveyor.resetTracking(0);
    const sched = new Scheduler<ConveyorEvent>();

    const exitTimes: { partId: number; timeMs: number }[] = [];
    const PRODUCE_INTERVAL_MS = 1_000;
    const HORIZON_MS = 20_000;

    // Producer schedules a "push" event every 1s.
    for (let t = 0, id = 0; t <= HORIZON_MS; t += PRODUCE_INTERVAL_MS, id++) {
      sched.schedule(t, { kind: "push", partId: id });
    }
    // Consumer is event-driven: when a push happens, schedule a
    // ready-check at conveyor.firstReadyAt() so we wake exactly when
    // the front becomes available.
    while (sched.size > 0) {
      const ev = sched.popMin();
      if (ev.payload.kind === "push") {
        const ok = conveyor.pushAt(ev.payload.partId ?? -1, ev.timeMs);
        if (!ok) continue; // back-pressure — drop the push for this proof
        // Wake the consumer when the just-pushed item becomes ready.
        // (firstReadyAt is the *front* item's readyAt — fine here since
        // FIFO + monotonic push times means front is always the oldest.)
        const wakeAt = conveyor.firstReadyAt();
        if (wakeAt !== undefined && wakeAt <= HORIZON_MS) {
          sched.schedule(wakeAt, { kind: "ready-check" });
        }
      } else if (ev.payload.kind === "ready-check") {
        // Drain everything that's currently ready.
        for (;;) {
          const part = conveyor.pullAt(ev.timeMs);
          if (part === undefined) break;
          exitTimes.push({ partId: part, timeMs: ev.timeMs });
        }
        // Schedule the next wakeup if more items are in transit.
        const next = conveyor.firstReadyAt();
        if (next !== undefined && next <= HORIZON_MS) {
          sched.schedule(next, { kind: "ready-check" });
        }
      }
    }

    // (a) first part exits at t=5000.
    expect(exitTimes[0]).toEqual({ partId: 0, timeMs: 5_000 });
    // (b) steady-state inter-arrival = 1000 ms.
    for (let i = 1; i < Math.min(exitTimes.length, 10); i++) {
      const delta = (exitTimes[i]?.timeMs ?? 0) - (exitTimes[i - 1]?.timeMs ?? 0);
      expect(delta).toBe(PRODUCE_INTERVAL_MS);
    }
    // (c) the 16th part entered at t=15000 → exits at t=20000 (still in window).
    const last = exitTimes.find((e) => e.partId === 15);
    expect(last).toBeDefined();
    expect(last?.timeMs).toBe(20_000);
  });

  it("back-pressure: small-capacity conveyor stalls the producer when full", () => {
    const conveyor = new DelayedBuffer<number>(3, 5_000); // 3-slot, 5s
    conveyor.resetTracking(0);

    // 5 quick pushes at t=0..4s — only first 3 land, 4th/5th rejected
    // because conveyor is full of in-transit parts.
    const accepted: number[] = [];
    const rejected: number[] = [];
    for (let i = 0; i < 5; i++) {
      const ok = conveyor.pushAt(i, i * 1_000);
      (ok ? accepted : rejected).push(i);
    }
    expect(accepted).toEqual([0, 1, 2]);
    expect(rejected).toEqual([3, 4]);
    // After t=5000, part 0 exits → slot opens.
    expect(conveyor.pullAt(5_000)).toBe(0);
    expect(conveyor.pushAt(3, 5_000)).toBe(true);
  });
});
