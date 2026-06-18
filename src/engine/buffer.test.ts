import { describe, expect, it } from "vitest";

import { Buffer, TrackedBuffer } from "./buffer";

describe("Buffer — capacity semantics", () => {
  it("rejects negative or non-integer capacity at construction", () => {
    expect(() => new Buffer<number>(-1)).toThrow();
    expect(() => new Buffer<number>(1.5)).toThrow();
  });

  it("capacity-0 buffer is always full and never accepts a push", () => {
    const b = new Buffer<number>(0);
    expect(b.isFull).toBe(true);
    expect(b.push(1)).toBe(false);
    expect(b.size).toBe(0);
  });

  it("capacity-5 buffer accepts 5 pushes; 6th returns false", () => {
    const b = new Buffer<number>(5);
    for (let i = 0; i < 5; i++) expect(b.push(i)).toBe(true);
    expect(b.isFull).toBe(true);
    expect(b.push(99)).toBe(false);
    expect(b.size).toBe(5);
  });

  it("pull on empty returns undefined", () => {
    const b = new Buffer<number>(5);
    expect(b.pull()).toBeUndefined();
  });

  it("FIFO order: push 1,2,3 → pull 1,2,3", () => {
    const b = new Buffer<number>(5);
    b.push(1);
    b.push(2);
    b.push(3);
    expect(b.pull()).toBe(1);
    expect(b.pull()).toBe(2);
    expect(b.pull()).toBe(3);
  });

  it("peek returns the front item without removing it", () => {
    const b = new Buffer<number>(5);
    b.push(42);
    expect(b.peek()).toBe(42);
    expect(b.size).toBe(1);
  });

  it("clear empties the buffer", () => {
    const b = new Buffer<number>(5);
    b.push(1);
    b.push(2);
    b.clear();
    expect(b.isEmpty).toBe(true);
  });
});

describe("TrackedBuffer — time-weighted WIP", () => {
  it("returns 0 average WIP when no time has elapsed", () => {
    const b = new TrackedBuffer<number>(10);
    b.resetTracking(0);
    expect(b.averageWIP(0)).toBe(0);
  });

  it("constant size produces matching average WIP", () => {
    // Push once at t=0, hold for 100s, average should be exactly 1.
    const b = new TrackedBuffer<number>(10);
    b.resetTracking(0);
    b.pushAt(1, 0);
    expect(b.averageWIP(100)).toBe(1);
  });

  it("integral matches manually-computed integral on a known pattern", () => {
    // t=0:   size 0
    // t=10:  push → size 1  (integral over [0,10] = 0*10 = 0)
    // t=30:  push → size 2  (integral over [10,30] = 1*20 = 20)
    // t=60:  pull → size 1  (integral over [30,60] = 2*30 = 60)
    // t=100: pull → size 0  (integral over [60,100] = 1*40 = 40)
    // Total integral over [0, 100] = 0 + 20 + 60 + 40 = 120
    // Average = 120 / 100 = 1.2
    const b = new TrackedBuffer<number>(10);
    b.resetTracking(0);
    b.pushAt(1, 10);
    b.pushAt(2, 30);
    b.pullAt(60);
    b.pullAt(100);

    expect(b.averageWIP(100)).toBe(1.2);
    expect(b.integral).toBe(120);
  });

  it("rejects tick called with a past time", () => {
    const b = new TrackedBuffer<number>(10);
    b.resetTracking(0);
    b.pushAt(1, 50);
    expect(() => b.pushAt(2, 40)).toThrow();
  });
});

describe("backpressure propagation (multi-buffer chain)", () => {
  it("when downstream is full, an in-between buffer accepts pushes until IT also fills", () => {
    // 3-station chain: A → buf1 → B → buf2 → C(slow consumer = no pulls).
    // If A keeps pushing, buf2 fills first, then B blocks, then buf1 fills, then A blocks.
    const buf1 = new Buffer<number>(3);
    const buf2 = new Buffer<number>(2);

    // Simulate A producing 4 parts; B forwarding what it pulls into buf2; C never pulls.
    let aPushedOk = 0;
    let bPushedOk = 0;
    for (let i = 0; i < 4; i++) {
      if (buf1.push(i)) aPushedOk++;
    }
    // A produced 4, but buf1 only holds 3 — so aPushedOk=3, buf1 is full.
    expect(aPushedOk).toBe(3);
    expect(buf1.isFull).toBe(true);

    // B drains buf1 into buf2 — peek-then-pull pattern: don't remove from buf1
    // until we know buf2 will accept. That's how realistic stations handle
    // backpressure without dropping parts on the floor.
    while (!buf1.isEmpty) {
      const next = buf1.peek();
      if (next === undefined) break;
      if (!buf2.push(next)) break; // B blocked
      buf1.pull(); // commit the move
      bPushedOk++;
    }
    // B forwarded 2 parts, then blocked on buf2. 1 part remains in buf1.
    expect(bPushedOk).toBe(2);
    expect(buf2.isFull).toBe(true);
    expect(buf1.size).toBe(1);
  });
});
