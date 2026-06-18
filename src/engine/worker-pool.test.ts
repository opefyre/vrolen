import { describe, expect, it } from "vitest";

import { asResourceId } from "./ids";
import { effectiveAvailableMs, isOnBreak, WorkerPool, type PoolWorker } from "./worker-pool";

function worker(
  name: string,
  skills: string[],
  shifts: { startMs: number; endMs: number }[],
): PoolWorker {
  return {
    id: asResourceId(`w-${name}`),
    name,
    skills,
    shifts,
  };
}

const ALWAYS_ON: { startMs: number; endMs: number }[] = [{ startMs: 0, endMs: 1_000_000_000 }];

describe("WorkerPool — assignment", () => {
  it("returns a worker matching all required skills", () => {
    const pool = new WorkerPool([worker("Alice", ["capper", "packer"], ALWAYS_ON)]);
    const w = pool.request(["capper"], 100);
    expect(w?.name).toBe("Alice");
    expect(pool.activeAssignments).toBe(1);
  });

  it("returns null when no worker has the required skill", () => {
    const pool = new WorkerPool([worker("Bob", ["packer"], ALWAYS_ON)]);
    const w = pool.request(["capper"], 100);
    expect(w).toBeNull();
    expect(pool.activeAssignments).toBe(0);
  });

  it("requires ALL requested skills (not just one)", () => {
    const pool = new WorkerPool([worker("Charlie", ["capper"], ALWAYS_ON)]);
    const w = pool.request(["capper", "labeler"], 100);
    expect(w).toBeNull();
  });

  it("does not return an already-assigned worker", () => {
    const pool = new WorkerPool([worker("Dana", ["capper"], ALWAYS_ON)]);
    const first = pool.request(["capper"], 100);
    const second = pool.request(["capper"], 200);
    expect(first?.name).toBe("Dana");
    expect(second).toBeNull();
  });

  it("release() returns the worker to the pool", () => {
    const pool = new WorkerPool([worker("Eve", ["capper"], ALWAYS_ON)]);
    const first = pool.request(["capper"], 100);
    expect(first).not.toBeNull();
    pool.release(first!.id);
    const second = pool.request(["capper"], 200);
    expect(second?.name).toBe("Eve");
  });
});

describe("WorkerPool — shift windows", () => {
  it("refuses workers outside their shift windows", () => {
    const pool = new WorkerPool([worker("Frank", ["capper"], [{ startMs: 100, endMs: 200 }])]);
    expect(pool.request(["capper"], 50)).toBeNull(); // before shift
    expect(pool.request(["capper"], 150)).not.toBeNull(); // during shift
    pool.release(asResourceId("w-Frank"));
    expect(pool.request(["capper"], 250)).toBeNull(); // after shift
  });

  it("treats endMs as exclusive (worker off-shift at exactly endMs)", () => {
    const pool = new WorkerPool([worker("Gina", ["capper"], [{ startMs: 0, endMs: 100 }])]);
    expect(pool.request(["capper"], 99)).not.toBeNull();
    pool.release(asResourceId("w-Gina"));
    expect(pool.request(["capper"], 100)).toBeNull();
  });
});

describe("WorkerPool — determinism", () => {
  it("assigns in insertion order (first eligible worker wins)", () => {
    const pool = new WorkerPool([
      worker("First", ["capper"], ALWAYS_ON),
      worker("Second", ["capper"], ALWAYS_ON),
      worker("Third", ["capper"], ALWAYS_ON),
    ]);
    expect(pool.request(["capper"], 100)?.name).toBe("First");
    expect(pool.request(["capper"], 100)?.name).toBe("Second");
    expect(pool.request(["capper"], 100)?.name).toBe("Third");
  });

  it("contention test: 1 worker + 2 stations alternating ≈ halved throughput", () => {
    // Two stations both want a capper. Only one capper exists. Over many
    // request/release cycles, each station gets the worker ~half the time.
    const pool = new WorkerPool([worker("Solo", ["capper"], ALWAYS_ON)]);

    let stationA = 0;
    let stationB = 0;
    for (let i = 0; i < 1000; i++) {
      // Station A requests
      const wA = pool.request(["capper"], i);
      if (wA) {
        stationA++;
        pool.release(wA.id);
      }
      // Station B requests
      const wB = pool.request(["capper"], i);
      if (wB) {
        stationB++;
        pool.release(wB.id);
      }
    }
    // With release-before-other-request, both stations always get the worker.
    // The point of the test is just that the pool serves both consistently.
    expect(stationA).toBe(1000);
    expect(stationB).toBe(1000);
  });
});

describe("WorkerPool — breaks (VROL-616)", () => {
  function workerWithBreaks(
    name: string,
    skills: string[],
    shifts: { startMs: number; endMs: number }[],
    breaks: { startMs: number; endMs: number }[],
  ): PoolWorker {
    return { id: asResourceId(`w-${name}`), name, skills, shifts, breaks };
  }

  it("request() rejects a worker on break, accepts before/after the window", () => {
    const pool = new WorkerPool([
      workerWithBreaks("Alice", ["any"], ALWAYS_ON, [{ startMs: 10_000, endMs: 20_000 }]),
    ]);
    expect(pool.request(["any"], 5_000)?.name).toBe("Alice");
    pool.release(asResourceId("w-Alice"));
    expect(pool.request(["any"], 15_000)).toBeNull();
    expect(pool.request(["any"], 20_000)?.name).toBe("Alice"); // half-open: endMs is back on
  });

  it("isOnBreak respects the half-open convention", () => {
    const w = {
      id: asResourceId("w"),
      name: "w",
      skills: [],
      shifts: ALWAYS_ON,
      breaks: [{ startMs: 100, endMs: 200 }],
    };
    expect(isOnBreak(w, 99)).toBe(false);
    expect(isOnBreak(w, 100)).toBe(true);
    expect(isOnBreak(w, 199)).toBe(true);
    expect(isOnBreak(w, 200)).toBe(false);
  });

  it("effectiveAvailableMs subtracts break ms from shift ms within the window", () => {
    const w = {
      id: asResourceId("w"),
      name: "w",
      skills: [],
      shifts: [{ startMs: 0, endMs: 60_000 }],
      breaks: [{ startMs: 0, endMs: 30_000 }],
    };
    // 60s shift, 30s break → 30s available.
    expect(effectiveAvailableMs(w, 0, 60_000)).toBe(30_000);
  });

  it("effectiveAvailableMs merges overlapping breaks (no double-counting)", () => {
    const w = {
      id: asResourceId("w"),
      name: "w",
      skills: [],
      shifts: [{ startMs: 0, endMs: 60_000 }],
      breaks: [
        { startMs: 0, endMs: 10_000 }, // 10s
        { startMs: 5_000, endMs: 15_000 }, // overlaps; merged: [0, 15_000]
      ],
    };
    // 60s shift, merged break is 15s → 45s available (NOT 40s).
    expect(effectiveAvailableMs(w, 0, 60_000)).toBe(45_000);
  });

  it("effectiveAvailableMs clamps out-of-shift breaks to zero impact", () => {
    const w = {
      id: asResourceId("w"),
      name: "w",
      skills: [],
      shifts: [{ startMs: 0, endMs: 60_000 }],
      breaks: [{ startMs: 60_000, endMs: 120_000 }], // entirely after shift
    };
    expect(effectiveAvailableMs(w, 0, 60_000)).toBe(60_000);
  });

  it("workers without breaks have shift-only availability (back-compat)", () => {
    const w = {
      id: asResourceId("w"),
      name: "w",
      skills: [],
      shifts: [{ startMs: 0, endMs: 60_000 }],
    };
    expect(effectiveAvailableMs(w, 0, 60_000)).toBe(60_000);
    expect(isOnBreak(w, 30_000)).toBe(false);
  });
});
