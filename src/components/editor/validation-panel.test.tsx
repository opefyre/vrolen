import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ValidationIssue, ValidationResult } from "@/lib/validate-scenario";

import { ValidationPanel } from "./validation-panel";

const errIssue = (overrides: Partial<ValidationIssue> = {}): ValidationIssue => ({
  code: "X_ERR",
  severity: "error",
  category: "topology",
  message: "Something broke",
  ...overrides,
});

const warnIssue = (overrides: Partial<ValidationIssue> = {}): ValidationIssue => ({
  code: "X_WARN",
  severity: "warning",
  category: "topology",
  message: "Something is iffy",
  ...overrides,
});

describe("ValidationPanel (VROL-304)", () => {
  it("renders the empty-state when no errors or warnings", () => {
    const result: ValidationResult = { errors: [], warnings: [] };
    render(<ValidationPanel result={result} onIssueFocus={() => {}} />);
    expect(screen.getByText(/No validation issues/i)).toBeInTheDocument();
  });

  it("renders errors and warnings sections with counts", () => {
    const result: ValidationResult = {
      errors: [errIssue(), errIssue({ code: "X_ERR2" })],
      warnings: [warnIssue()],
    };
    render(<ValidationPanel result={result} onIssueFocus={() => {}} />);
    expect(screen.getByText(/2 errors/i)).toBeInTheDocument();
    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
  });

  it("fires onIssueFocus when an issue with nodeId is clicked", () => {
    const spy = vi.fn();
    const result: ValidationResult = {
      errors: [errIssue({ nodeId: "n42", message: "Click me" })],
      warnings: [],
    };
    render(<ValidationPanel result={result} onIssueFocus={spy} />);
    fireEvent.click(screen.getByRole("button", { name: /Click me/i }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]?.nodeId).toBe("n42");
  });

  it("disables the click affordance when issue has no nodeId", () => {
    const spy = vi.fn();
    const result: ValidationResult = {
      errors: [errIssue({ message: "Detached issue" })],
      warnings: [],
    };
    render(<ValidationPanel result={result} onIssueFocus={spy} />);
    const btn = screen.getByRole("button", { name: /Detached issue/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("shows the fix hint when an issue has one", () => {
    const result: ValidationResult = {
      errors: [errIssue({ fix: "Reconnect the broken edge" })],
      warnings: [],
    };
    render(<ValidationPanel result={result} onIssueFocus={() => {}} />);
    expect(screen.getByText(/Reconnect the broken edge/i)).toBeInTheDocument();
  });
});
