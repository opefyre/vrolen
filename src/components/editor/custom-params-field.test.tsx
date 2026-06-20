import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RESERVED_PARAM_NAMES, type CustomParam } from "@/lib/custom-params";

import { CustomParamsField } from "./custom-params-field";

describe("CustomParamsField (VROL-286)", () => {
  it("adds a new param with default type 'string'", () => {
    const onChange = vi.fn();
    render(<CustomParamsField value={[]} onChange={onChange} />);
    const input = screen.getByLabelText("New param name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "operator_skill" } });
    fireEvent.click(screen.getByText("+ Add"));
    expect(onChange).toHaveBeenCalledWith([{ name: "operator_skill", type: "string", value: "" }]);
  });

  it("rejects reserved names", () => {
    const onChange = vi.fn();
    render(<CustomParamsField value={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("New param name"), {
      target: { value: "capacity" },
    });
    fireEvent.click(screen.getByText("+ Add"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/reserved field name/i)).toBeInTheDocument();
  });

  it("rejects duplicate names", () => {
    const onChange = vi.fn();
    const existing: CustomParam[] = [{ name: "x", type: "string", value: "" }];
    render(<CustomParamsField value={existing} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("New param name"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByText("+ Add"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("coerces value to 0 when switching string → number", () => {
    const onChange = vi.fn();
    render(
      <CustomParamsField
        value={[{ name: "x", type: "string", value: "abc" }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Type for x"), { target: { value: "number" } });
    expect(onChange).toHaveBeenCalledWith([{ name: "x", type: "number", value: 0 }]);
  });

  it("coerces value to false when switching to boolean", () => {
    const onChange = vi.fn();
    render(
      <CustomParamsField
        value={[{ name: "flag", type: "string", value: "hello" }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Type for flag"), {
      target: { value: "boolean" },
    });
    expect(onChange).toHaveBeenCalledWith([{ name: "flag", type: "boolean", value: false }]);
  });

  it("removes a row when the trash button is clicked", () => {
    const onChange = vi.fn();
    render(
      <CustomParamsField
        value={[
          { name: "a", type: "string", value: "" },
          { name: "b", type: "string", value: "" },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove a"));
    expect(onChange).toHaveBeenCalledWith([{ name: "b", type: "string", value: "" }]);
  });

  it("RESERVED_PARAM_NAMES includes the well-known fields", () => {
    for (const name of ["capacity", "label", "stationType", "skills"]) {
      expect(RESERVED_PARAM_NAMES.has(name)).toBe(true);
    }
  });
});
