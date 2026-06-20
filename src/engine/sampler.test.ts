import { describe, expect, it } from "vitest";

import { constant } from "./distribution";
import { SeededPrng } from "./prng";
import { makeSampler } from "./sampler";

describe("Sampler (VROL-76)", () => {
  it("next() returns the constant value repeatedly", () => {
    const s = makeSampler(constant(42), new SeededPrng(1));
    expect(s.next()).toBe(42);
    expect(s.next()).toBe(42);
    expect(s.next()).toBe(42);
  });

  it("exposes the source distribution", () => {
    const d = constant(7);
    const s = makeSampler(d, new SeededPrng(1));
    expect(s.distribution).toBe(d);
  });

  it("respects SampleOptions.min/max clamp", () => {
    const s = makeSampler(constant(100), new SeededPrng(1), { max: 50 });
    expect(s.next()).toBe(50);
  });
});
