import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { NumberField } from "./number-field";

describe("NumberField (VROL-645)", () => {
  it("commits only on blur — keystroke changes do not call onChange", () => {
    const onChange = vi.fn();
    render(<NumberField id="x" label="x" value={3} onChange={onChange} min={1} max={10} />);
    const input = screen.getByLabelText("x") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("clamps on blur to the min/max range", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <NumberField id="x" label="x" value={5} onChange={onChange} min={1} max={10} />,
    );
    const input = screen.getByLabelText("x") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(10);
    // Simulate the parent reacting to onChange by updating the value prop;
    // the effect should sync the draft back so the input shows the clamped
    // value the next render.
    rerender(<NumberField id="x" label="x" value={10} onChange={onChange} min={1} max={10} />);
    expect(input.value).toBe("10");
  });

  it("reverts the draft on Escape without calling onChange", () => {
    const onChange = vi.fn();
    render(<NumberField id="x" label="x" value={3} onChange={onChange} min={1} max={10} />);
    const input = screen.getByLabelText("x") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe("3");
  });

  it("renders the helper text when provided", () => {
    render(
      <NumberField id="x" label="x" value={3} onChange={() => {}} helperText="must be 1 to 10" />,
    );
    expect(screen.getByText("must be 1 to 10")).toBeInTheDocument();
  });

  it("commits on Enter and blurs the input", () => {
    const onChange = vi.fn();
    render(<NumberField id="x" label="x" value={3} onChange={onChange} max={10} />);
    const input = screen.getByLabelText("x") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter", target: input });
    expect(onChange).toHaveBeenCalledWith(8);
  });
});
