import { describe, expect, it } from "vitest";

import { Buffer } from "./buffer";
import { MultiInputBuffer, MultiOutputBuffer } from "./multi-buffer";

describe("MultiInputBuffer", () => {
  it("pulls from the first non-empty source in priority order", () => {
    const a = new Buffer<number>(10);
    const b = new Buffer<number>(10);
    a.push(1);
    b.push(2);
    const mib = new MultiInputBuffer<number>([a, b]);

    expect(mib.size).toBe(2);
    expect(mib.isEmpty).toBe(false);
    expect(mib.pull()).toBe(1);
    expect(mib.pull()).toBe(2);
    expect(mib.pull()).toBeUndefined();
    expect(mib.isEmpty).toBe(true);
  });

  it("isEmpty only when ALL sources are empty", () => {
    const a = new Buffer<number>(10);
    const b = new Buffer<number>(10);
    a.push(1);
    const mib = new MultiInputBuffer<number>([a, b]);
    expect(mib.isEmpty).toBe(false);
    mib.pull();
    expect(mib.isEmpty).toBe(true);
  });

  it("isFull always false (consumer side)", () => {
    const a = new Buffer<number>(1);
    a.push(1);
    const mib = new MultiInputBuffer<number>([a]);
    expect(mib.isFull).toBe(false);
  });

  it("push throws (inputs are pull-only)", () => {
    const mib = new MultiInputBuffer<number>([new Buffer<number>(10)]);
    expect(() => mib.push(1)).toThrow();
  });
});

describe("MultiOutputBuffer", () => {
  it("pushes to the first non-full destination", () => {
    const a = new Buffer<number>(1);
    const b = new Buffer<number>(10);
    const mob = new MultiOutputBuffer<number>([a, b]);

    expect(mob.push(1)).toBe(true);
    expect(mob.push(2)).toBe(true);
    expect(mob.push(3)).toBe(true);

    expect(a.size).toBe(1);
    expect(b.size).toBe(2);
  });

  it("returns false when every destination is full", () => {
    const a = new Buffer<number>(1);
    const b = new Buffer<number>(1);
    a.push(99);
    b.push(99);
    const mob = new MultiOutputBuffer<number>([a, b]);
    expect(mob.isFull).toBe(true);
    expect(mob.push(1)).toBe(false);
  });

  it("isFull when ALL destinations are full", () => {
    const a = new Buffer<number>(1);
    const b = new Buffer<number>(2);
    a.push(1);
    b.push(1);
    const mob = new MultiOutputBuffer<number>([a, b]);
    expect(mob.isFull).toBe(false); // b still has capacity
    b.push(2);
    expect(mob.isFull).toBe(true);
  });

  it("pull throws (outputs are push-only)", () => {
    const mob = new MultiOutputBuffer<number>([new Buffer<number>(10)]);
    expect(() => mob.pull()).toThrow();
  });
});
