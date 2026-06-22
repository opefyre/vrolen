import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DurationInput, msToUnit, pickDefaultUnit, unitToMs } from "./duration-input";

describe("DurationInput unit helpers (VROL-822)", () => {
  it("pickDefaultUnit picks the friendliest unit by magnitude", () => {
    expect(pickDefaultUnit(0)).toBe("ms");
    expect(pickDefaultUnit(999)).toBe("ms");
    expect(pickDefaultUnit(1000)).toBe("s");
    expect(pickDefaultUnit(1500)).toBe("s");
    expect(pickDefaultUnit(59_999)).toBe("s");
    expect(pickDefaultUnit(60_000)).toBe("min");
    expect(pickDefaultUnit(3_599_999)).toBe("min");
    expect(pickDefaultUnit(3_600_000)).toBe("h");
    expect(pickDefaultUnit(7_200_000)).toBe("h");
  });

  it("msToUnit rounds non-ms units to one decimal", () => {
    // 30000ms → 30s (not 30.0)
    expect(msToUnit(30_000, "s")).toBe(30);
    // 30500ms → 30.5s
    expect(msToUnit(30_500, "s")).toBe(30.5);
    // 1500ms → 1.5s
    expect(msToUnit(1_500, "s")).toBe(1.5);
    // ms unit returns integer
    expect(msToUnit(999.4, "ms")).toBe(999);
    // 90000ms → 1.5min
    expect(msToUnit(90_000, "min")).toBe(1.5);
    // 7_200_000ms → 2h
    expect(msToUnit(7_200_000, "h")).toBe(2);
  });

  it("unitToMs round-trips with msToUnit at clean magnitudes", () => {
    expect(unitToMs(30, "s")).toBe(30_000);
    expect(unitToMs(1.5, "s")).toBe(1_500);
    expect(unitToMs(2, "h")).toBe(7_200_000);
    expect(unitToMs(5, "min")).toBe(300_000);
    expect(unitToMs(250, "ms")).toBe(250);
  });
});

describe("DurationInput (VROL-822)", () => {
  it("renders the initial unit derived from valueMs — 1500ms → 1.5s", () => {
    render(<DurationInput id="d" label="Cycle time" valueMs={1500} onChangeMs={() => {}} />);
    const input = screen.getByLabelText("Cycle time") as HTMLInputElement;
    expect(input.value).toBe("1.5");
    // The unit selector trigger should display "s".
    const trigger = screen.getByLabelText("Cycle time unit");
    expect(trigger.textContent).toContain("s");
  });

  it("honors defaultUnit when supplied", () => {
    render(
      <DurationInput
        id="d"
        label="Horizon"
        valueMs={60_000}
        onChangeMs={() => {}}
        defaultUnit="min"
      />,
    );
    const input = screen.getByLabelText("Horizon") as HTMLInputElement;
    // 60_000ms → 1 min
    expect(input.value).toBe("1");
  });

  it("renders 30000ms in seconds as '30', not '30.0'", () => {
    render(
      <DurationInput id="d" label="Cycle" valueMs={30_000} onChangeMs={() => {}} defaultUnit="s" />,
    );
    const input = screen.getByLabelText("Cycle") as HTMLInputElement;
    expect(input.value).toBe("30");
  });

  it("emits ms when the user types a value in the current unit", () => {
    const onChangeMs = vi.fn();
    render(
      <DurationInput id="d" label="Cycle" valueMs={1500} onChangeMs={onChangeMs} defaultUnit="s" />,
    );
    const input = screen.getByLabelText("Cycle") as HTMLInputElement;
    // Type 2.5 (seconds), blur to commit.
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.blur(input, { target: { value: "2.5" } });
    expect(onChangeMs).toHaveBeenCalledWith(2_500);
  });

  it("clamps to ms-domain min/max regardless of unit", () => {
    const onChangeMs = vi.fn();
    render(
      <DurationInput
        id="d"
        label="Cycle"
        valueMs={5_000}
        onChangeMs={onChangeMs}
        defaultUnit="s"
        min={1_000}
        max={10_000}
      />,
    );
    const input = screen.getByLabelText("Cycle") as HTMLInputElement;
    // Try to set 50s — should clamp to 10s = 10_000ms (the max).
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);
    // NumberField clamps in the display unit first (max=10), then our
    // handler converts; either way the final ms must be 10_000.
    expect(onChangeMs).toHaveBeenLastCalledWith(10_000);
  });

  it("does not fire onChangeMs when the underlying value is unchanged", () => {
    const onChangeMs = vi.fn();
    render(
      <DurationInput
        id="d"
        label="Cycle"
        valueMs={2_000}
        onChangeMs={onChangeMs}
        defaultUnit="s"
      />,
    );
    const input = screen.getByLabelText("Cycle") as HTMLInputElement;
    // Typing the same value (2 in seconds) then blurring should be a no-op.
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.blur(input, { target: { value: "2" } });
    expect(onChangeMs).not.toHaveBeenCalled();
  });
});
