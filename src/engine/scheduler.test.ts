import { describe, expect, it } from "vitest";

import { EventInPastError, Scheduler, SchedulerEmptyError } from "./scheduler";

describe("Scheduler — empty state", () => {
  it("peek() returns null on an empty scheduler", () => {
    const s = new Scheduler<string>();
    expect(s.peek()).toBeNull();
  });

  it("popMin() throws SchedulerEmptyError when empty", () => {
    const s = new Scheduler<string>();
    expect(() => s.popMin()).toThrow(SchedulerEmptyError);
  });

  it("starts at currentTime=0 and size=0", () => {
    const s = new Scheduler<string>();
    expect(s.currentTime).toBe(0);
    expect(s.size).toBe(0);
  });
});

describe("Scheduler — ordering", () => {
  it("events scheduled at t=10, t=5, t=8 drain in order 5, 8, 10", () => {
    const s = new Scheduler<string>();
    s.schedule(10, "ten");
    s.schedule(5, "five");
    s.schedule(8, "eight");

    expect(s.popMin().payload).toBe("five");
    expect(s.popMin().payload).toBe("eight");
    expect(s.popMin().payload).toBe("ten");
  });

  it("ties broken by insertion order — first scheduled at t=10 returns first", () => {
    const s = new Scheduler<string>();
    s.schedule(10, "A");
    s.schedule(10, "B");
    s.schedule(10, "C");

    expect(s.popMin().payload).toBe("A");
    expect(s.popMin().payload).toBe("B");
    expect(s.popMin().payload).toBe("C");
  });

  it("currentTime advances to the popped event's timeMs", () => {
    const s = new Scheduler<string>();
    s.schedule(100, "x");
    s.schedule(50, "y");
    expect(s.currentTime).toBe(0);

    s.popMin(); // pulls y at t=50
    expect(s.currentTime).toBe(50);

    s.popMin(); // pulls x at t=100
    expect(s.currentTime).toBe(100);
  });

  it("peek() returns the minimum without removing it", () => {
    const s = new Scheduler<number>();
    s.schedule(20, 20);
    s.schedule(10, 10);
    s.schedule(30, 30);

    const peeked = s.peek();
    expect(peeked).not.toBeNull();
    expect(peeked?.timeMs).toBe(10);
    expect(s.size).toBe(3); // unchanged
  });
});

describe("Scheduler — time monotonicity", () => {
  it("scheduling at currentTime is allowed (equal — not strictly past)", () => {
    const s = new Scheduler<string>();
    s.schedule(50, "first");
    s.popMin();
    expect(s.currentTime).toBe(50);

    // Equal to currentTime is fine
    expect(() => {
      s.schedule(50, "same-time");
    }).not.toThrow();
  });

  it("scheduling before currentTime throws EventInPastError with both times", () => {
    const s = new Scheduler<string>();
    s.schedule(100, "advance");
    s.popMin();
    expect(s.currentTime).toBe(100);

    let thrown: unknown;
    try {
      s.schedule(50, "too-late");
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(EventInPastError);
    const err = thrown as EventInPastError;
    expect(err.scheduledTimeMs).toBe(50);
    expect(err.currentTimeMs).toBe(100);
    expect(err.message).toContain("50");
    expect(err.message).toContain("100");
  });
});

describe("Scheduler — clear", () => {
  it("clear() removes all events and resets currentTime", () => {
    const s = new Scheduler<string>();
    s.schedule(10, "a");
    s.schedule(20, "b");
    s.popMin();
    expect(s.currentTime).toBe(10);
    expect(s.size).toBe(1);

    s.clear();
    expect(s.size).toBe(0);
    expect(s.currentTime).toBe(0);
    expect(s.peek()).toBeNull();
  });

  it("after clear(), seq counter resets — new events start at insertion-order 0 again", () => {
    const s = new Scheduler<string>();
    s.schedule(10, "old-1");
    s.schedule(10, "old-2");
    s.clear();
    s.schedule(10, "new-A");
    s.schedule(10, "new-B");

    expect(s.popMin().payload).toBe("new-A");
    expect(s.popMin().payload).toBe("new-B");
  });
});

describe("Scheduler — stochastic drain (heap correctness on larger n)", () => {
  it("drains 10,000 randomly-timed events in monotonic order", () => {
    const s = new Scheduler<number>();
    const N = 10_000;
    // Pseudo-deterministic input (avoid Math.random for repeatability in CI)
    for (let i = 0; i < N; i++) {
      // Linear congruential — varies enough to exercise heap rebalancing
      const t = ((i * 2654435769) % 1_000_000) + 1;
      s.schedule(t, i);
    }
    expect(s.size).toBe(N);

    let prevTime = -1;
    let drained = 0;
    while (s.size > 0) {
      const ev = s.popMin();
      expect(ev.timeMs).toBeGreaterThanOrEqual(prevTime);
      prevTime = ev.timeMs;
      drained++;
    }
    expect(drained).toBe(N);
  });
});
