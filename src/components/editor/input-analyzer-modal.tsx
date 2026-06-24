/**
 * Input Analyzer modal — Arena-style. Paste a CSV/whitespace-separated
 * dataset, fit Normal / Lognormal / Exponential / Weibull / Gamma, and
 * apply the best-fit distribution to the selected station.
 */

import { CheckCircle2, FlaskConical, Sparkles, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Distribution } from "@/engine";
import { type FitCandidate, fitDistributions, parseDataset } from "@/lib/fit-distribution";

interface InputAnalyzerModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onApply: (distribution: Distribution) => void;
}

const SAMPLE_DATASET = `# Paste one number per line, or comma-separated.
98 110 102 95 120 88 105 117 100 96
93 108 119 102 99 90 112 104 107 100
115 92 101 116 109 97 103 111 100 106`;

export function InputAnalyzerModal({ open, onClose, onApply }: InputAnalyzerModalProps) {
  const [raw, setRaw] = useState<string>("");
  const summary = useMemo(() => {
    const values = parseDataset(raw);
    if (values.length < 5) return null;
    return fitDistributions(values);
  }, [raw]);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Input Analyzer"
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="border-border bg-card text-foreground relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border shadow-2xl">
        <div className="border-border flex items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-2">
            <FlaskConical className="text-sim-running h-4 w-4" aria-hidden />
            <h2 className="font-heading text-base font-semibold">Input Analyzer</h2>
            <span className="text-muted-foreground text-xs">
              · paste measured data, fit a distribution
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-muted-foreground hover:text-foreground rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto p-5 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs font-medium">
              Paste numeric data (cycle times in ms, one per line or comma-separated)
            </div>
            <textarea
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
              }}
              placeholder={SAMPLE_DATASET}
              className="border-border bg-background h-72 w-full resize-none rounded-md border p-2 font-mono text-xs"
              aria-label="Numeric dataset"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setRaw(SAMPLE_DATASET);
                }}
              >
                Load example
              </Button>
              {/* VROL-983 — file upload path. Lets a plant engineer drag in
                  a CSV of historical cycle times instead of pasting. */}
              <label
                className="border-input bg-background hover:bg-accent inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium"
                title="Upload CSV / TSV / plain numbers"
              >
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/plain,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    file
                      .text()
                      .then((txt) => {
                        setRaw(txt);
                      })
                      .catch(() => {
                        /* silent — user can paste instead */
                      });
                    e.target.value = "";
                  }}
                />
                Upload CSV
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRaw("");
                }}
              >
                Clear
              </Button>
              <span className="text-muted-foreground ml-auto text-[11px]">
                {summary ? `${String(summary.n)} samples` : "need ≥ 5 samples"}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {summary ? (
              <SummaryColumn summary={summary} onApply={onApply} onClose={onClose} />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
        <div className="border-border bg-muted/30 text-muted-foreground border-t px-5 py-2 text-[11px]">
          Best-fit ranked by{" "}
          <strong className="text-foreground">Kolmogorov-Smirnov D statistic</strong> (lower =
          closer match). PASS = D ≤ 1.36 / √n (α = 0.05 critical value).
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-background/40 flex h-full flex-col items-center justify-center rounded-md border border-dashed p-6 text-center">
      <Sparkles className="text-muted-foreground mb-2 h-5 w-5" aria-hidden />
      <p className="text-muted-foreground text-sm">
        Paste at least 5 numbers on the left to see ranked candidate fits with KS goodness-of-fit.
      </p>
    </div>
  );
}

function SummaryColumn({
  summary,
  onApply,
  onClose,
}: {
  readonly summary: NonNullable<ReturnType<typeof fitDistributions>>;
  readonly onApply: (d: Distribution) => void;
  readonly onClose: () => void;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Sample summary</CardTitle>
          <CardDescription>Descriptive stats of the pasted dataset.</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <span>n</span>
          <span className="text-foreground text-right font-mono tabular-nums">{summary.n}</span>
          <span>mean</span>
          <span className="text-foreground text-right font-mono tabular-nums">
            {summary.mean.toFixed(3)}
          </span>
          <span>stddev</span>
          <span className="text-foreground text-right font-mono tabular-nums">
            {summary.stddev.toFixed(3)}
          </span>
          <span>min · max</span>
          <span className="text-foreground text-right font-mono tabular-nums">
            {summary.min.toFixed(2)} · {summary.max.toFixed(2)}
          </span>
        </CardContent>
      </Card>
      <div className="space-y-1.5">
        <div className="text-muted-foreground text-xs font-medium">
          Ranked candidates (KS — lower is better)
        </div>
        {summary.candidates.length === 0 ? (
          <p className="text-muted-foreground text-xs">No candidate could be fit.</p>
        ) : (
          summary.candidates.map((c, i) => (
            <CandidateRow
              key={c.distributionKind}
              candidate={c}
              isBest={i === 0}
              onApply={() => {
                onApply(c.distribution);
                onClose();
              }}
            />
          ))
        )}
      </div>
    </>
  );
}

function CandidateRow({
  candidate,
  isBest,
  onApply,
}: {
  readonly candidate: FitCandidate;
  readonly isBest: boolean;
  readonly onApply: () => void;
}) {
  const Icon = candidate.pass ? CheckCircle2 : XCircle;
  const tone = candidate.pass ? "text-sim-running" : "text-sim-down-foreground";
  return (
    <div
      className={`border-border bg-background/40 flex items-center gap-2 rounded-md border p-2 ${isBest ? "ring-sim-running/30 ring-2" : ""}`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{candidate.label}</div>
        <div className="text-muted-foreground font-mono text-[10px]">
          D = {candidate.ksStatistic.toFixed(4)} · critical {candidate.ksCritical.toFixed(4)}
        </div>
      </div>
      {isBest ? (
        <span className="bg-sim-running/15 text-sim-running rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
          Best
        </span>
      ) : null}
      <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={onApply}>
        Use this
      </Button>
    </div>
  );
}
