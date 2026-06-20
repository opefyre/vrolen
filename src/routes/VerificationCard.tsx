/**
 * Run verification card — the "I trust this model" panel a customer
 * asks for first. Shows Little's Law + mass balance checks side by side
 * with pass/fail badges and the actual numbers.
 *
 * Rendered inside the Overview tab right under the recommendations
 * card so it sits near the headline narrative.
 */

import { CheckCircle2, Info, XCircle } from "lucide-react";

import type { ChainResult } from "@/engine";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyRun } from "@/lib/verify-run";

export function VerificationCard({
  result,
  horizonMs,
}: {
  readonly result: ChainResult;
  readonly horizonMs: number;
}) {
  const checks = verifyRun(result, horizonMs);
  const fmt = (n: number, digits = 2) =>
    n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return (
    <Card id="verification">
      <CardHeader>
        <CardTitle className="font-heading text-base">Verification</CardTitle>
        <CardDescription>
          Conservation laws the engine should respect — a credibility check.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
