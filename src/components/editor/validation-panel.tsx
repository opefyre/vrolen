/**
 * VROL-304 — validation panel.
 *
 * Compact popover triggered by the toolbar badge. Lists all issues grouped
 * by severity (errors first) then category. Each issue is clickable —
 * onIssueFocus is fired with the issue so the parent can pan the canvas
 * to the offending node.
 */

import { AlertCircle, AlertTriangle, Wand2 } from "lucide-react";

import type { ValidationIssue, ValidationResult } from "@/lib/validate-scenario";

interface ValidationPanelProps {
  readonly result: ValidationResult;
  readonly onIssueFocus: (issue: ValidationIssue) => void;
  /** VROL-658 — invoked when the user clicks "Fix it" on an issue with a fixAction. */
  readonly onIssueFix?: (issue: ValidationIssue) => void;
}

function severityIcon(s: ValidationIssue["severity"]) {
  if (s === "error") {
    return <AlertCircle className="text-sim-down h-3.5 w-3.5 shrink-0" aria-hidden />;
  }
  return <AlertTriangle className="text-sim-setup h-3.5 w-3.5 shrink-0" aria-hidden />;
}

export function ValidationPanel({ result, onIssueFocus, onIssueFix }: ValidationPanelProps) {
  const { errors, warnings } = result;
  const total = errors.length + warnings.length;
  if (total === 0) {
    return (
      <div className="text-muted-foreground p-3 text-xs">
        No validation issues. Scenario is ready to run.
      </div>
    );
  }
  return (
    <div className="max-h-80 overflow-y-auto p-2">
      {errors.length > 0 ? (
        <Section
          title={`${String(errors.length)} error${errors.length === 1 ? "" : "s"}`}
          issues={errors}
          onClick={onIssueFocus}
          onFix={onIssueFix}
        />
      ) : null}
      {warnings.length > 0 ? (
        <Section
          title={`${String(warnings.length)} warning${warnings.length === 1 ? "" : "s"}`}
          issues={warnings}
          onClick={onIssueFocus}
          onFix={onIssueFix}
        />
      ) : null}
    </div>
  );
}

function Section({
  title,
  issues,
  onClick,
  onFix,
}: {
  title: string;
  issues: readonly ValidationIssue[];
  onClick: (issue: ValidationIssue) => void;
  onFix?: ((issue: ValidationIssue) => void) | undefined;
}) {
  return (
    <div className="space-y-1 pb-2">
      <div className="text-muted-foreground px-1 pt-1 text-[10px] font-medium tracking-wide uppercase">
        {title}
      </div>
      <ul className="space-y-1">
        {issues.map((iss, idx) => (
          <li
            key={`${iss.code}-${String(idx)}`}
            className="hover:bg-muted flex items-start gap-2 rounded-md p-2 text-xs"
          >
            <button
              type="button"
              onClick={() => {
                onClick(iss);
              }}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              disabled={!iss.nodeId}
              title={iss.nodeId ? "Click to focus the offending station" : undefined}
            >
              {severityIcon(iss.severity)}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="text-foreground leading-snug">{iss.message}</div>
                {iss.fix ? (
                  <div className="text-muted-foreground leading-snug">{iss.fix}.</div>
                ) : null}
                <div className="text-muted-foreground text-[10px] tracking-wide uppercase">
                  {iss.category} · {iss.code}
                </div>
              </div>
            </button>
            {iss.fixAction && onFix ? (
              <button
                type="button"
                onClick={() => {
                  onFix(iss);
                }}
                className="border-input bg-background hover:bg-accent inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
                title="Apply the suggested fix"
                data-testid="fix-button"
              >
                <Wand2 className="h-3 w-3" /> Fix
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
