import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ValidationIssue } from "@/lib/validate-scenario";

import { FieldErrorIndicator } from "./field-error-indicator";

const iss = (overrides: Partial<ValidationIssue> = {}): ValidationIssue => ({
  code: "X",
  severity: "error",
  category: "topology",
  message: "thing broke",
  ...overrides,
});

describe("FieldErrorIndicator (VROL-660)", () => {
  it("renders nothing when there are no issues", () => {
    const { container } = render(<FieldErrorIndicator issues={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a red dot when at least one issue is an error", () => {
    render(<FieldErrorIndicator issues={[iss({ severity: "error" })]} />);
    const dot = screen.getByTestId("field-error-indicator");
    expect(dot.className).toContain("bg-sim-down");
  });

  it("renders a yellow dot when only warnings are present", () => {
    render(<FieldErrorIndicator issues={[iss({ severity: "warning" })]} />);
    const dot = screen.getByTestId("field-error-indicator");
    expect(dot.className).toContain("bg-sim-setup");
  });

  it("joins issue messages with '; ' in the title attribute", () => {
    render(
      <FieldErrorIndicator
        issues={[iss({ message: "Alpha" }), iss({ message: "Beta", code: "Y" })]}
      />,
    );
    const dot = screen.getByTestId("field-error-indicator");
    expect(dot.getAttribute("title")).toBe("Alpha; Beta");
  });
});
