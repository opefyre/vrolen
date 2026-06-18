import { describe, expect, it } from "vitest";

import { StateTimeTracker } from "./state-time-tracker";

describe("StateTimeTracker", () => {
  it("accumulates time correctly across transitions", () => {
    // Idle 0-100 (100ms), Running 100-300 (200ms), Down 300-350 (50ms),
    // Running 350-400 (50ms). Total = 400ms.
    const t = new StateTimeTracker("Idle", 0);
    t.recordTransition("Running", 100);
    t.recordTransition("Down", 300);
    t.recordTransition("Running", 350);
    t.finalize(400);

    expect(t.timeInState("Idle")).toBe(100);
    expect(t.timeInState("Running")).toBe(250); // 200 + 50
    expect(t.timeInState("Down")).toBe(50);
    expect(t.totalTime()).toBe(400);
  });

  it("percentages sum to 1.0 (within float epsilon)", () => {
    const t = new StateTimeTracker("Idle", 0);
    t.recordTransition("Running", 100);
    t.recordTransition("Starved", 700);
    t.finalize(1000);

    const pcts = t.percentages();
    let sum = 0;
    for (const p of pcts.values()) sum += p;
    expect(sum).toBeCloseTo(1.0, 6);
  });

  it("finalize advances accumulation to endTimeMs", () => {
    const t = new StateTimeTracker("Running", 0);
    t.finalize(500);
    expect(t.timeInState("Running")).toBe(500);
  });

  it("rejects transitions that go back in time", () => {
    const t = new StateTimeTracker("Idle", 100);
    expect(() => t.recordTransition("Running", 50)).toThrow();
  });

  it("returns empty percentages when no time has elapsed", () => {
    const t = new StateTimeTracker("Idle", 0);
    expect(t.percentages().size).toBe(0);
  });
});
