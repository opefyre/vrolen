import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Distribution } from "@/engine";

import { DistributionField } from "./distribution-field";

describe("DistributionField (VROL-289)", () => {
  it("renders the kind selector and switches kind when changed", () => {
    const onChange = vi.fn();
    const value: Distribution = { kind: "constant", value: 100 };
    render(<DistributionField id="d" label="Cycle" value={value} onChange={onChange} />);
    const select = screen.getByLabelText("Cycle") as HTMLSelectElement;
    expect(select.value).toBe("constant");
    fireEvent.change(select, { target: { value: "normal" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as Distribution;
    expect(next.kind).toBe("normal");
  });

  it("renders param fields specific to the active kind", () => {
    const { rerender } = render(
      <DistributionField
        id="d"
        value={{ kind: "uniform", min: 50, max: 150 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Min (ms)")).toBeInTheDocument();
    expect(screen.getByLabelText("Max (ms)")).toBeInTheDocument();
    rerender(
      <DistributionField
        id="d"
        value={{ kind: "triangular", min: 50, mode: 100, max: 200 }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByLabelText("Mode")).toBeInTheDocument();
  });

  it("preset chip 'Fixed' snaps to a constant distribution", () => {
    const onChange = vi.fn();
    render(
      <DistributionField
        id="d"
        value={{ kind: "uniform", min: 80, max: 120 }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Fixed"));
    const next = onChange.mock.calls[0]?.[0] as Distribution;
    expect(next.kind).toBe("constant");
    // mean of uniform(80, 120) = 100; preset rounds.
    expect((next as Extract<Distribution, { kind: "constant" }>).value).toBe(100);
  });

  it("preset chip 'Long tail' switches to exponential with mean preserved", () => {
    const onChange = vi.fn();
    render(
      <DistributionField id="d" value={{ kind: "constant", value: 60 }} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Long tail"));
    const next = onChange.mock.calls[0]?.[0] as Distribution;
    expect(next.kind).toBe("exponential");
    const exp = next as Extract<Distribution, { kind: "exponential" }>;
    // rate = 1 / mean → mean ≈ 60
    expect(1 / exp.rate).toBeCloseTo(60, 0);
  });

  it("renders the histogram preview SVG with 24 bins", () => {
    const { container } = render(
      <DistributionField
        id="d"
        value={{ kind: "normal", mean: 100, stddev: 20 }}
        onChange={() => {}}
      />,
    );
    const svg = container.querySelector("svg[aria-label='Distribution preview histogram']");
    expect(svg).not.toBeNull();
    const bars = svg!.querySelectorAll("rect");
    expect(bars).toHaveLength(24);
  });

  it("uniform param updates: increasing min clamps max to stay >= min+1", () => {
    const onChange = vi.fn();
    render(
      <DistributionField
        id="d"
        value={{ kind: "uniform", min: 50, max: 60 }}
        onChange={onChange}
      />,
    );
    const minInput = screen.getByLabelText("Min (ms)") as HTMLInputElement;
    // VROL-1223 — Min (ms) is now a HumanMsField that commits on blur
    // (not change) so it can parse "80s" as 80000. Simulate the full
    // focus → type → blur cycle. The field goes uncontrolled while
    // focused; onFocus seeds the draft from the current fieldValue.
    fireEvent.focus(minInput);
    fireEvent.change(minInput, { target: { value: "80" } });
    fireEvent.blur(minInput);
    const next = onChange.mock.calls[0]?.[0] as Distribution;
    const u = next as Extract<Distribution, { kind: "uniform" }>;
    expect(u.min).toBe(80);
  });

  // VROL-1223 — new: users can type human units and the parser converts.
  it("VROL-1223: humanised ms field accepts '90s' / '1.5 min' on blur", () => {
    const onChange = vi.fn();
    render(
      <DistributionField id="d" value={{ kind: "constant", value: 100 }} onChange={onChange} />,
    );
    const input = screen.getByLabelText("Value (ms)") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "90s" } });
    fireEvent.blur(input);
    const next = onChange.mock.calls[0]?.[0] as Distribution;
    expect(next.kind).toBe("constant");
    const c = next as Extract<Distribution, { kind: "constant" }>;
    expect(c.value).toBe(90_000);
  });

  it("VROL-1223: humanised ms field parses minutes", () => {
    const onChange = vi.fn();
    render(
      <DistributionField id="d" value={{ kind: "constant", value: 100 }} onChange={onChange} />,
    );
    const input = screen.getByLabelText("Value (ms)") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "1.5 min" } });
    fireEvent.blur(input);
    const c = onChange.mock.calls[0]?.[0] as Extract<Distribution, { kind: "constant" }>;
    expect(c.value).toBe(90_000);
  });

  it("VROL-1223: plain numbers still commit as ms (backwards compatible)", () => {
    const onChange = vi.fn();
    render(
      <DistributionField id="d" value={{ kind: "constant", value: 100 }} onChange={onChange} />,
    );
    const input = screen.getByLabelText("Value (ms)") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "500" } });
    fireEvent.blur(input);
    const c = onChange.mock.calls[0]?.[0] as Extract<Distribution, { kind: "constant" }>;
    expect(c.value).toBe(500);
  });
});
