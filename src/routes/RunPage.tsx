/**
 * /run — first UI consumer of the engine library.
 *
 * Click Run → invoke runChain() against a hardcoded 3-station chain fixture
 * (50ms / 200ms / 50ms — second station is the bottleneck), display the
 * resulting KPIs in shadcn Card primitives.
 *
 * The fixture matches the Little's-Law test scenario in chain-harness.test.ts
 * so the numbers shown here mirror what the test suite asserts. Real scenario
 * authoring lives behind the editor (E08, future sprints).
 */
import { Activity, AlertTriangle, Gauge, Layers, Play, Timer } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { constant, type ChainResult, runChain, SeededPrng } from "@/engine";
import { toast } from "@/lib/toast";

const FIXTURE_LABELS = ["Filler (50ms)", "Capper (200ms — bottleneck)", "Labeler (50ms)"];
const FIXTURE_CYCLE_MS = [50, 200, 50];
const HORIZON_MS = 60_000; // 1 simulated minute
const WARMUP_MS = 5_000; // discard first 5 simulated seconds

function formatNumber(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function stateToColorClass(state: string): string {
  switch (state) {
    case "Running":
      return "bg-sim-running";
    case "Starved":
      return "bg-sim-starved";
    case "BlockedOut":
      return "bg-sim-blocked";
    case "Down":
      return "bg-sim-down";
    case "Setup":
      return "bg-sim-setup";
    case "Maintenance":
      return "bg-sim-maintenance";
    case "Idle":
    default:
      return "bg-sim-idle";
  }
}

function KpiCard({
  icon: Icon,
  label,
  value,
  unit,
  hint,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardDescription className="text-muted-foreground flex items-center gap-2 text-xs tracking-wide uppercase">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </CardDescription>
        <CardTitle className="font-mono text-3xl font-semibold tracking-tight tabular-nums">
          {value}
          {unit ? (
            <span className="text-muted-foreground ml-1.5 text-sm font-normal">{unit}</span>
          ) : null}
        </CardTitle>
        {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
      </CardHeader>
    </Card>
  );
}

export default function RunPage() {
  const [result, setResult] = useState<ChainResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = (): void => {
    setIsRunning(true);
    setResult(null);

    // Small async tick so the UI shows "Running…" briefly. The sim itself is
    // synchronous in Phase 0 — fast enough not to need a worker for this size.
    setTimeout(() => {
      try {
        const t0 = performance.now();
        const r = runChain({
          stationCycleTimes: FIXTURE_CYCLE_MS.map(constant),
          interStationBufferCapacity: 10,
          horizonMs: HORIZON_MS,
          warmupMs: WARMUP_MS,
          prng: new SeededPrng(0xc0ffee),
          stationLabels: FIXTURE_LABELS,
        });
        const wallMs = performance.now() - t0;
        setResult(r);
        toast.success("Simulation complete", {
          description: `${r.completed.toLocaleString()} parts in ${wallMs.toFixed(0)}ms wall-clock`,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        toast.error("Simulation failed", { description: message });
      } finally {
        setIsRunning(false);
      }
    }, 0);
  };

  const throughputPerHour =
    result && result.elapsedMs > 0 ? result.throughputLambda * 3_600_000 : 0;

  return (
    <div className="space-y-8 p-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Run a simulation</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          First UI consumer of the engine library. Runs a hardcoded 3-station chain (Filler → Capper
          → Labeler) for 1 simulated minute. The Capper at 200ms is the bottleneck — system
          throughput should land near 1/(200ms) = 5 parts/sec.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Fixture</CardTitle>
          <CardDescription>
            Hardcoded for Phase 0 demo. Real scenario authoring lands behind the editor (future
            sprint).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5 font-mono text-sm">
            {FIXTURE_LABELS.map((label) => (
              <div key={label} className="text-foreground/80">
                {label}
              </div>
            ))}
          </div>
          <div className="text-muted-foreground text-xs">
            Horizon: {HORIZON_MS.toLocaleString()} ms · Warm-up: {WARMUP_MS.toLocaleString()} ms ·
            Inter-station buffer: 10 · Seed: 0xc0ffee
          </div>
          <Button onClick={handleRun} disabled={isRunning} className="gap-2">
            <Play className="h-4 w-4" />
            {isRunning ? "Running…" : "Run simulation"}
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight">Results</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={Layers}
              label="Completed parts"
              value={result.completed.toLocaleString()}
              hint={`during measurement window (post-warmup)`}
            />
            <KpiCard
              icon={Gauge}
              label="Throughput"
              value={formatNumber(throughputPerHour, 0)}
              unit="parts/hour"
              hint={`λ = ${formatNumber(result.throughputLambda * 1000, 3)} parts/sec`}
            />
            <KpiCard
              icon={Activity}
              label="Avg WIP (L)"
              value={formatNumber(result.averageWipL)}
              hint="time-weighted across inter-buffers + in-flight"
            />
            <KpiCard
              icon={Timer}
              label="Time-in-system (W)"
              value={formatNumber(result.avgTimeInSystemW, 0)}
              unit="ms"
              hint="per exited part, on average"
            />
          </div>

          {result.bottlenecks.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2 text-base">
                  <AlertTriangle className="text-sim-blocked-foreground h-4 w-4" />
                  Bottleneck analysis
                </CardTitle>
                <CardDescription>
                  Station with the highest running % is the constraint. For non-bottleneck stations,
                  the dominant non-Running state explains why they aren&apos;t running more.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {result.bottlenecks.map((b, idx) => (
                    <div
                      key={String(b.stationId)}
                      className="border-border bg-card flex flex-col gap-2 rounded-md border p-3"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-muted-foreground font-mono text-xs">
                            #{idx + 1}
                          </span>
                          <span className="font-medium">{b.label ?? String(b.stationId)}</span>
                          {idx === 0 ? (
                            <span className="bg-sim-running text-sim-running-foreground rounded-full px-2 py-0.5 text-xs font-medium">
                              bottleneck
                            </span>
                          ) : null}
                        </div>
                        <span className="font-mono text-sm tabular-nums">
                          {formatNumber(b.runningPct * 100, 1)}% running
                        </span>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        Primary {idx === 0 ? "non-running state" : "reason"}:{" "}
                        <span className="text-foreground font-medium">{b.primaryReason}</span> ·{" "}
                        {formatNumber(b.primaryReasonPct * 100, 1)}% of time
                      </div>
                      <div className="flex gap-1">
                        {b.breakdown.map((seg) => (
                          <div
                            key={seg.state}
                            title={`${seg.state}: ${(seg.pct * 100).toFixed(1)}%`}
                            className={`h-2 rounded-sm ${stateToColorClass(seg.state)}`}
                            style={{ width: `${String(Math.max(seg.pct * 100, 1))}%` }}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-base">Per-station completed</CardTitle>
              <CardDescription>
                Monotonically decreases upstream → downstream because of warm-up bleed and
                bottleneck buffering.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {result.perStationCompleted.map((count, i) => {
                  const label = FIXTURE_LABELS[i] ?? `Station ${String(i)}`;
                  const max = Math.max(...result.perStationCompleted, 1);
                  const pct = (count / max) * 100;
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-foreground/80">{label}</span>
                        <span className="font-mono tabular-nums">{count.toLocaleString()}</span>
                      </div>
                      <div className="bg-muted h-2 overflow-hidden rounded-full">
                        <div
                          className="bg-sim-running h-full rounded-full transition-[width]"
                          style={{ width: `${String(pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>
      ) : (
        <p className="text-muted-foreground text-sm">
          Press <strong>Run simulation</strong> to see results.
        </p>
      )}
    </div>
  );
}
