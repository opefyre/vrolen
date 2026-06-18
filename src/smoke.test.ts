import { describe, expect, it } from "vitest";

// Trivial assertion — proves the Vitest runner itself loads and executes.
// If this fails, nothing else in the suite can be trusted.
describe("test runner sanity", () => {
  it("evaluates basic arithmetic", () => {
    expect(1 + 1).toBe(2);
  });
});
