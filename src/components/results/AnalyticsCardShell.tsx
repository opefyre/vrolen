/**
 * VROL-849 — Shared shell for analytics cards (sensitivity, WIP curve,
 * optimization, replications).
 *
 * Before this, every card hand-rolled its own header, status copy, Run
 * button placement, and "click to start" empty state. The visual drift
 * was noticeable. This shell standardises:
 *   - title + description + status pill on the right
 *   - Run button in the header (idle / done only)
 *   - spinner overlay while running
 *   - inline error message + Retry button when something blew up
 *
 * Card bodies stay the responsibility of each consumer — the shell just
 * gates which body shows up for each status.
 */

import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, Play, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type AnalyticsCardStatus = "idle" | "running" | "done" | "error";

interface AnalyticsCardShellProps {
  readonly id?: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly status: AnalyticsCardStatus;
  /** Optional explicit pill label — falls back to the status default. */
  readonly statusLabel?: string;
  /** Fires when the user clicks Run (idle/done) or Retry (error). */
  readonly onRun?: () => void;
  /** Label override for the header Run button (e.g. "Run sweep"). */
  readonly runLabel?: string;
  /** Body shown when status is "error" — Retry button is appended. */
  readonly errorMessage?: string;
  readonly children: ReactNode;
}

const STATUS_DEFAULT_LABEL: Record<AnalyticsCardStatus, string> = {
  idle: "Off",
  running: "Running…",
  done: "Done",
  error: "Error",
};

function StatusPill({
  status,
  label,
}: {
  readonly status: AnalyticsCardStatus;
  readonly label: string;
}) {
  // Match the rest of the analytics UI: muted for idle, primary tint for
  // done, amber-ish for running, red for error. Kept compact so the header
  // doesn't grow when long titles wrap.
  const toneClass =
    status === "done"
      ? "border-sim-running/30 bg-sim-running/10 text-sim-running"
      : status === "running"
        ? "border-sim-setup/30 bg-sim-setup/10 text-sim-setup-foreground"
        : status === "error"
          ? "border-sim-down/30 bg-sim-down/10 text-sim-down-foreground"
          : "border-border bg-muted/40 text-muted-foreground";
  const Icon =
    status === "done"
      ? CheckCircle2
      : status === "running"
        ? Loader2
        : status === "error"
          ? AlertTriangle
          : CircleDashed;
  return (
    <span
      data-slot="analytics-status-pill"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        toneClass,
      )}
    >
      <Icon className={cn("h-3 w-3", status === "running" ? "animate-spin" : "")} aria-hidden />
      {label}
    </span>
  );
}

export function AnalyticsCardShell({
  id,
  title,
  description,
  status,
  statusLabel,
  onRun,
  runLabel = "Run",
  errorMessage,
  children,
}: AnalyticsCardShellProps) {
  const pillLabel = statusLabel ?? STATUS_DEFAULT_LABEL[status];
  const canShowRunButton = typeof onRun === "function" && (status === "idle" || status === "done");
  const headerButtonLabel = status === "done" ? `Re-${runLabel.toLowerCase()}` : runLabel;
  return (
    <Card {...(id ? { id } : {})}>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="font-heading flex items-center gap-2 text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} label={pillLabel} />
          {canShowRunButton ? (
            <Button
              size="sm"
              variant="outline"
              onClick={onRun}
              className="gap-1"
              data-slot="analytics-run-button"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              {headerButtonLabel}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {status === "error" ? (
          <div
            role="alert"
            className="border-sim-down/30 bg-sim-down/5 text-sim-down-foreground flex flex-col items-start gap-2 rounded-md border p-3 text-sm"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <span>{errorMessage ?? "Something went wrong while running this analysis."}</span>
            </div>
            {onRun ? (
              <Button
                size="sm"
                variant="outline"
                onClick={onRun}
                className="gap-1"
                data-slot="analytics-retry-button"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="relative">
            {children}
            {status === "running" ? (
              <div
                data-slot="analytics-running-overlay"
                className="bg-card/70 absolute inset-0 flex items-center justify-center rounded-md backdrop-blur-[1px]"
                aria-live="polite"
              >
                <span className="text-muted-foreground inline-flex items-center gap-2 text-xs">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  {pillLabel}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
