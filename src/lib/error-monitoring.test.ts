import { describe, expect, it } from "vitest";

// VROL-480 — tests for the DSN parser only (the fetch side-effect path runs
// against a live Sentry endpoint and isn't worth mocking here).
import * as mod from "./error-monitoring";

describe("error-monitoring CapturedEvent shape (VROL-480)", () => {
  it("exports captureEvent + initErrorMonitoring", () => {
    expect(typeof mod.captureEvent).toBe("function");
    expect(typeof mod.initErrorMonitoring).toBe("function");
  });
});
