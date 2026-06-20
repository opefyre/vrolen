/**
 * VROL-660 — small severity dot rendered next to Inspector fields that
 * have active validation issues. Hover the dot to see the message in a
 * native title tooltip. Errors take priority over warnings (red wins).
 */

import type { ValidationIssue } from "@/lib/validate-scenario";

interface FieldErrorIndicatorProps {
  readonly issues: readonly ValidationIssue[];
}

export function FieldErrorIndicator({ issues }: FieldErrorIndicatorProps) {
  if (issues.length === 0) return null;
  const hasError = issues.some((i) => i.severity === "error");
  const message = issues.map((i) => i.message).join("; ");
  return (
    <span
      data-testid="field-error-indicator"
      className={`inline-block h-2 w-2 rounded-full ${hasError ? "bg-sim-down" : "bg-sim-setup"}`}
      aria-label={hasError ? "Validation error" : "Validation warning"}
      title={message}
    />
  );
}
