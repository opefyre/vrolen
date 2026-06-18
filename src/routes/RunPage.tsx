/**
 * /run — first UI consumer of the engine library.
 *
 * User tweaks station cycle times + horizon + warmup + seed, clicks Run,
 * sees KPIs + bottleneck analysis populate. Config persisted to localStorage
 * so reloads don't reset the user's last-used numbers.
 *
 * Real scenario authoring lives behind the editor (E08, future sprints).
 * This route is the bridge between "engine library exists in tests" and
 * "engine is a working tool in the app."
 */
import {
  Activity,
  AlertTriangle,
  Dice5,
  Gauge,
  Layers,
  Play,
  RotateCcw,
  Timer,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { constant, type ChainResult, runChain, SeededPrng } from "@/engine";
import { toast } from "@/lib/toast";

interface RunConfig {
  cycleTimes: [number, number, number];
  horizonMs: number;
  warmupMs: number;
  seed: number;
}

const DEFAULT_CONFIG: RunConfig = {
  cycleTimes: [50, 200, 50],
  horizonMs: 60_000,
  warmupMs: 5_000,
  seed: 0xc0ffee,
};

const STORAGE_KEY = "vrolen.run-page-fixture";

const STATION_BASE_LABELS = ["Filler", "Capper", "Labeler"];

function loadConfig(): RunConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RunConfig>;
    return {
      cycleTimes: (parsed.cycleTimes && parsed.cycleTimes.length === 3
        ? parsed.cycleTimes
        : DEFAULT_CONFIG.cycleTimes) as [number, number, number],
      horizonMs: parsed.horizonMs ?? DEFAULT_CONFIG.horizonMs,
      warmupMs: parsed.warmupMs ?? DEFAULT_CONFIG.warmupMs,
      seed: parsed.seed ?? DEFAULT_CONFIG.seed,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(c: RunConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem?.(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // Persistence unavailable; in-memory is fine.
  }
}

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

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="relative">
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          step={step}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="font-mono tabular-nums"
        />
        {suffix ? (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
            {suffix}
          </span>
        ) : null}
      </div>
    </label>
  );
}

export default function RunPage() {
  const [config, setConfig] = useState<RunConfig>(loadConfig);
  const [result, setResult] = useState<ChainResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const setCycleTime = (idx: number, value: number): void => {
    setConfig((c) => {
      const next: [number, number, number] = [...c.cycleTimes];
      next[idx] = value;
      return { ...c, cycleTimes: next };
    });
  };

  const handleReset = (): void => {
    setConfig(DEFAULT_CONFIG);
    setResult(null);
    toast.info("Reset to defaults");
  };

  const handleRandomSeed = (): void => {
    setConfig((c) => ({ ...c, seed: Math.floor(Math.random() * 0xffffffff) }));
  };

  const handleRun = (): void => {
    setIsRunning(true);
    setResult(null);

    setTimeout(() => {
      try {
        const t0 = performance.now();
        const labels = STATION_BASE_LABELS.map(
          (l, i) => `${l} (${String(config.cycleTimes[i])}ms)`,
        );
        const r = runChain({
          stationCycleTimes: config.cycleTimes.map((ms) => constant(ms)),
          interStationBufferCapacity: 10,
          horizonMs: config.horizonMs,
          warmupMs: Math.min(config.warmupMs, Math.floor(config.horizonMs / 2)),
          prng: new SeededPrng(config.seed),
          stationLabels: labels,
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

  const bottleneckIdx = config.cycleTimes.indexOf(Math.max(...config.cycleTimes));
  const expectedRate = 1 / Math.max(...config.cycleTimes); // parts/ms
  const expectedPerHour = expectedRate * 3_600_000;

  const throughputPerHour =
    result && result.elapsedMs > 0 ? result.throughputLambda * 3_600_000 : 0;

  return (
    <div className="space-y-8 p-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Run a simulation</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Tweak the 3-station chain fixture below and click Run. Theoretical throughput is{" "}
          1/(slowest cycle) — currently ≈{" "}
          <span className="font-mono tabular-nums">{formatNumber(expectedPerHour, 0)}</span>{" "}
          parts/hour with station #{bottleneckIdx + 1} as the bottleneck.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Fixture</CardTitle>
          <CardDescription>
            Persisted to localStorage. Real scenario authoring lands with the editor (E08).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {config.cycleTimes.map((cycle, i) => (
              <NumberField
                key={i}
                label={`${STATION_BASE_LABELS[i] ?? `Station ${String(i + 1)}`} cycle time`}
                value={cycle}
                onChange={(n) => {
                  setCycleTime(i, n);
                }}
                min={1}
                suffix="ms"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumberField
              label="Horizon (sim time)"
              value={config.horizonMs}
              onChange={(n) => {
                setConfig((c) => ({ ...c, horizonMs: n }));
              }}
              min={1000}
              step={1000}
              suffix="ms"
            />
            <NumberField
              label="Warm-up"
              value={config.warmupMs}
              onChange={(n) => {
                setConfig((c) => ({ ...c, warmupMs: n }));
              }}
              min={0}
              step={1000}
              suffix="ms"
            />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <NumberField
                  label="Seed (PRNG)"
                  value={config.seed}
                  onChange={(n) => {
                    setConfig((c) => ({ ...c, seed: Math.floor(n) }));
                  }}
                  min={0}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                aria-label="Roll a random seed"
                onClick={handleRandomSeed}
                className="mb-px"
              >
                <Dice5 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button onClick={handleRun} disabled={isRunning} className="gap-2">
              <Play className="h-4 w-4" />
              {isRunning ? "Running…" : "Run simulation"}
            </Button>
            <Button variant="outline" onClick={handleReset} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Reset to defaults
            </Button>
          </div>
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
              hint="during measurement window (post-warmup)"
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
                  const label = `${STATION_BASE_LABELS[i] ?? `Station ${String(i + 1)}`} (${String(config.cycleTimes[i])}ms)`;
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
