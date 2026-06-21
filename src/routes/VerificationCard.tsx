/**
 * Run verification card — the "I trust this model" panel a customer
 * asks for first. Shows Little's Law + mass balance checks side by side
 * with pass/fail badges and the actual numbers, plus a Welch's-method
 * warm-up recommendation with a one-click Apply.
 *
 * Rendered inside the Overview tab right under the recommendations
 * card so it sits near the headline narrative.
 */

import { CheckCircle2, Hourglass, Info, ShieldCheck, XCircle } from "lucide-react";

import type { ChainResult } from "@/engine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyRun } from "@/lib/verify-run";
import { detectWarmup } from "@/lib/warmup-detection";

export function VerificationCard({
  result,
  horizonMs,
  currentWarmupMs,
  onApplyWarmup,
}: {
  readonly result: ChainResult;
  readonly horizonMs: number;
  /** Optional — currently-configured warmupMs (drives the diff label). */
  readonly currentWarmupMs?: number;
  /** Optional — wiring for an "Apply" button that bumps run-settings warmup. */
  readonly onApplyWarmup?: (ms: number) => void;
}) {
  const checks = verifyRun(result, horizonMs);
  const warmup = detectWarmup(result.samples, horizonMs);
  const fmt = (n: number, digits = 2) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const fmtMs = (ms: number): string =>
    ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms.toFixed(0)}ms`;
  const showApply =
    warmup.recommendedMs !== null &&
    onApplyWarmup &&
    typeof currentWarmupMs === "number" &&
    Math.abs(warmup.recommendedMs - currentWarmupMs) >= 250;
  return (
    <Card id="verification">
      <CardHeader>
        <CardTitle className="font-heading flex items-center gap-2 text-base">
          <ShieldCheck className="h-4 w-4" aria-hidden /> Verification
        </CardTitle>
        <CardDescription>
          Conservation laws the engine should respect — a credibility check.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {checks.map((c) => {
            const Icon = c.status === "pass" ? CheckCircle2 : c.status === "fail" ? XCircle : Info;
            const tone =
              c.status === "pass"
                ? "text-sim-running"
                : c.status === "fail"
                  ? "text-sim-down-foreground"
                  : "text-muted-foreground";
            const badge = c.status === "pass" ? "PASS" : c.status === "fail" ? "FAIL" : "INFO";
            return (
              <div
                key={c.id}
                className="border-border bg-background/40 flex flex-col gap-1 rounded-md border p-3"
              >
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 ${tone}`} aria-hidden />
                  <span className="text-sm font-medium">{c.title}</span>
                  <span className={`ml-auto font-mono text-[10px] ${tone}`}>{badge}</span>
                </div>
                <div className="text-muted-foreground text-xs">{c.description}</div>
                <div className="text-muted-foreground mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                  <span className="truncate">{c.lhsLabel}</span>
                  <span className="text-right font-mono tabular-nums">{fmt(c.lhs)}</span>
                  <span className="truncate">{c.rhsLabel}</span>
                  <span className="text-right font-mono tabular-nums">{fmt(c.rhs)}</span>
                  {c.status === "info" ? null : (
                    <>
                      <span className="truncate">error</span>
                      <span className={`text-right font-mono tabular-nums ${tone}`}>
                        {fmt(c.errorPct, 1)}%
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {warmup.recommendedMs !== null ? (
          <div className="border-border bg-background/40 flex flex-col gap-1 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Hourglass className="text-muted-foreground h-4 w-4" aria-hidden />
              <span className="text-sm font-medium">Warm-up (Welch&rsquo;s method)</span>
              <span className="text-muted-foreground ml-auto font-mono text-[10px]">
                {String(Math.round(warmup.confidence * 100))}% confidence
              </span>
            </div>
            <div className="text-muted-foreground text-xs">{warmup.note}</div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="text-muted-foreground">
                recommended{" "}
                <span className="text-foreground font-mono tabular-nums">
                  {fmtMs(warmup.recommendedMs)}
                </span>
              </span>
              {typeof currentWarmupMs === "number" ? (
                <span className="text-muted-foreground">
                  current{" "}
                  <span className="text-foreground font-mono tabular-nums">
                    {fmtMs(currentWarmupMs)}
                  </span>
                </span>
              ) : null}
              {showApply ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 px-2 text-[11px]"
                  onClick={() => {
                    onApplyWarmup(warmup.recommendedMs!);
                  }}
                >
                  Apply &amp; re-run
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
