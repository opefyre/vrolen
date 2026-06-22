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
  Award,
  Dice5,
  Gauge,
  Layers,
  Package,
  Play,
  RotateCcw,
  Timer,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState } from "@/components/EmptyState";
import { cycleStats } from "@/lib/cycle-stats";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  asMaterialId,
  type ChainBreakdownConfig,
  type ChainMaterialConfig,
  type ChainResult,
  constant,
  MaterialPool,
  runChain,
  SeededPrng,
} from "@/engine";
import { toast } from "@/lib/toast";

interface MaterialsConfig {
  enabled: boolean;
  bottles: number;
  caps: number;
  replenishment: {
    enabled: boolean;
    atMs: number;
    amount: number;
  };
}

interface BreakdownsConfig {
  enabled: boolean;
  mtbfMs: number; // mean — used as the rate-source for exponential MTBF
  mttrMs: number;
}

interface RunConfig {
  cycleTimes: [number, number, number];
  horizonMs: number;
  warmupMs: number;
  seed: number;
  materials: MaterialsConfig;
  breakdowns: BreakdownsConfig;
}

const DEFAULT_CONFIG: RunConfig = {
  cycleTimes: [50, 200, 50],
  horizonMs: 60_000,
  warmupMs: 5_000,
  seed: 0xc0ffee,
  materials: {
    enabled: false,
    bottles: 1000,
    caps: 1000,
    replenishment: {
      enabled: false,
      atMs: 10_000,
      amount: 500,
    },
  },
  breakdowns: {
    enabled: false,
    mtbfMs: 10_000,
    mttrMs: 2_000,
  },
};

const BOTTLES_ID = asMaterialId("bottles");
const CAPS_ID = asMaterialId("caps");

const STORAGE_KEY = "vrolen.run-page-fixture";

const STATION_BASE_LABELS = ["Filler", "Capper", "Labeler"];

function loadConfig(): RunConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage?.getItem?.(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RunConfig>;
    const materialsParsed = parsed.materials ?? DEFAULT_CONFIG.materials;
    const breakdownsParsed = parsed.breakdowns ?? DEFAULT_CONFIG.breakdowns;
    return {
      cycleTimes: (parsed.cycleTimes && parsed.cycleTimes.length === 3
        ? parsed.cycleTimes
        : DEFAULT_CONFIG.cycleTimes) as [number, number, number],
      horizonMs: parsed.horizonMs ?? DEFAULT_CONFIG.horizonMs,
      warmupMs: parsed.warmupMs ?? DEFAULT_CONFIG.warmupMs,
      seed: parsed.seed ?? DEFAULT_CONFIG.seed,
      materials: {
        enabled: materialsParsed.enabled ?? DEFAULT_CONFIG.materials.enabled,
        bottles: materialsParsed.bottles ?? DEFAULT_CONFIG.materials.bottles,
        caps: materialsParsed.caps ?? DEFAULT_CONFIG.materials.caps,
        replenishment: {
          enabled:
            materialsParsed.replenishment?.enabled ??
            DEFAULT_CONFIG.materials.replenishment.enabled,
          atMs: materialsParsed.replenishment?.atMs ?? DEFAULT_CONFIG.materials.replenishment.atMs,
          amount:
            materialsParsed.replenishment?.amount ?? DEFAULT_CONFIG.materials.replenishment.amount,
        },
      },
      breakdowns: {
        enabled: breakdownsParsed.enabled ?? DEFAULT_CONFIG.breakdowns.enabled,
        mtbfMs: breakdownsParsed.mtbfMs ?? DEFAULT_CONFIG.breakdowns.mtbfMs,
        mttrMs: breakdownsParsed.mttrMs ?? DEFAULT_CONFIG.breakdowns.mttrMs,
      },
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
        const materialsCfg: ChainMaterialConfig | undefined = config.materials.enabled
          ? {
              initialInventory: [
                [BOTTLES_ID, config.materials.bottles],
                [CAPS_ID, config.materials.caps],
              ],
              stationRecipes: [
                {
                  stationIndex: 1, // Capper consumes the recipe
                  requirements: [
                    { materialId: BOTTLES_ID, qtyPerPart: 1 },
                    { materialId: CAPS_ID, qtyPerPart: 1 },
                  ],
                },
              ],
              ...(config.materials.replenishment.enabled
                ? {
                    replenishments: [
                      {
                        materialId: BOTTLES_ID,
                        amount: config.materials.replenishment.amount,
                        atMs: config.materials.replenishment.atMs,
                      },
                    ],
                  }
                : {}),
            }
          : undefined;
        const breakdownsCfg: ChainBreakdownConfig | undefined = config.breakdowns.enabled
          ? {
              mtbfMs: { kind: "exponential", rate: 1 / Math.max(1, config.breakdowns.mtbfMs) },
              mttrMs: constant(Math.max(1, config.breakdowns.mttrMs)),
            }
          : undefined;
        const r = runChain({
          stationCycleTimes: config.cycleTimes.map((ms) => constant(ms)),
          interStationBufferCapacity: 10,
          horizonMs: config.horizonMs,
          warmupMs: Math.min(config.warmupMs, Math.floor(config.horizonMs / 2)),
          prng: new SeededPrng(config.seed),
          stationLabels: labels,
          ...(materialsCfg ? { materials: materialsCfg } : {}),
          ...(breakdownsCfg ? { breakdowns: breakdownsCfg } : {}),
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

  // Pre-run material runway preview — assume the Capper (slowest path) consumes
  // at 1 unit per cycle, so per-ms rate ≈ 1 / capperCycle.
  let runwayPreview: { materialLabel: string; runwayMs: number } | null = null;
  if (config.materials.enabled) {
    const pool = new MaterialPool([
      [BOTTLES_ID, config.materials.bottles],
      [CAPS_ID, config.materials.caps],
    ]);
    const capperCycle = Math.max(1, config.cycleTimes[1] ?? 1);
    const rate = 1 / capperCycle;
    const first = pool.firstToDeplete(
      new Map([
        [BOTTLES_ID, rate],
        [CAPS_ID, rate],
      ]),
    );
    if (first) {
      runwayPreview = {
        materialLabel: first.materialId === BOTTLES_ID ? "bottles" : "caps",
        runwayMs: first.runwayMs,
      };
    }
  }

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
      <div
        role="status"
        className="border-sim-setup/40 bg-sim-setup/10 text-sim-setup-foreground rounded-md border px-3 py-2 text-xs"
      >
        <strong>Engine demo fixture.</strong> This page tweaks a hard-coded 3-station chain for
        engine-validation purposes. For real scenario authoring with a full DAG, the canvas,
        replications, cost layer, and verification panel, head to the{" "}
        <a
          href="/editor"
          onClick={(e) => {
            // VROL-829 — SPA nav so we don't full-reload back into the editor.
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigate("/editor");
          }}
          className="font-medium underline"
        >
          Editor
        </a>
        .
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Fixture</CardTitle>
          <CardDescription>
            Persisted to localStorage. Use the Editor for real scenario authoring.
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
          <div className="border-border space-y-3 rounded-md border border-dashed p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={config.materials.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setConfig((c) => ({ ...c, materials: { ...c.materials, enabled } }));
                }}
                className="accent-sim-running h-4 w-4"
              />
              <Package className="h-4 w-4" />
              Capper consumes a recipe (1 bottle + 1 cap per part)
            </label>
            {config.materials.enabled ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Starting bottles"
                    value={config.materials.bottles}
                    onChange={(n) => {
                      setConfig((c) => ({
                        ...c,
                        materials: { ...c.materials, bottles: Math.floor(n) },
                      }));
                    }}
                    min={0}
                  />
                  <NumberField
                    label="Starting caps"
                    value={config.materials.caps}
                    onChange={(n) => {
                      setConfig((c) => ({
                        ...c,
                        materials: { ...c.materials, caps: Math.floor(n) },
                      }));
                    }}
                    min={0}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium">
                  <input
                    type="checkbox"
                    checked={config.materials.replenishment.enabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setConfig((c) => ({
                        ...c,
                        materials: {
                          ...c.materials,
                          replenishment: { ...c.materials.replenishment, enabled },
                        },
                      }));
                    }}
                    className="accent-sim-running h-4 w-4"
                  />
                  Schedule a single bottle replenishment
                </label>
                {config.materials.replenishment.enabled ? (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <NumberField
                      label="Replenish at"
                      value={config.materials.replenishment.atMs}
                      onChange={(n) => {
                        setConfig((c) => ({
                          ...c,
                          materials: {
                            ...c.materials,
                            replenishment: {
                              ...c.materials.replenishment,
                              atMs: Math.floor(n),
                            },
                          },
                        }));
                      }}
                      min={0}
                      step={1000}
                      suffix="ms"
                    />
                    <NumberField
                      label="Bottles delivered"
                      value={config.materials.replenishment.amount}
                      onChange={(n) => {
                        setConfig((c) => ({
                          ...c,
                          materials: {
                            ...c.materials,
                            replenishment: {
                              ...c.materials.replenishment,
                              amount: Math.floor(n),
                            },
                          },
                        }));
                      }}
                      min={1}
                    />
                  </div>
                ) : null}
                {runwayPreview ? (
                  <p className="text-muted-foreground text-xs">
                    Predicted runway (Capper-rate): <strong>{runwayPreview.materialLabel}</strong>{" "}
                    deplete in{" "}
                    <span className="font-mono tabular-nums">
                      {formatNumber(runwayPreview.runwayMs, 0)}
                    </span>{" "}
                    ms ≈{" "}
                    <span className="font-mono tabular-nums">
                      {formatNumber(runwayPreview.runwayMs / 1000, 1)}
                    </span>{" "}
                    s. Horizon is{" "}
                    <span className="font-mono tabular-nums">
                      {formatNumber(config.horizonMs / 1000, 1)}
                    </span>{" "}
                    s — expect{" "}
                    {runwayPreview.runwayMs < config.horizonMs
                      ? "starvation"
                      : "no material starvation"}
                    .
                  </p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="border-border space-y-3 rounded-md border border-dashed p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={config.breakdowns.enabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setConfig((c) => ({ ...c, breakdowns: { ...c.breakdowns, enabled } }));
                }}
                className="accent-sim-running h-4 w-4"
              />
              <Zap className="h-4 w-4" />
              Stochastic breakdowns (exp MTBF, constant MTTR)
            </label>
            {config.breakdowns.enabled ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <NumberField
                    label="Mean time between failures"
                    value={config.breakdowns.mtbfMs}
                    onChange={(n) => {
                      setConfig((c) => ({
                        ...c,
                        breakdowns: { ...c.breakdowns, mtbfMs: Math.max(1, Math.floor(n)) },
                      }));
                    }}
                    min={100}
                    step={1000}
                    suffix="ms"
                  />
                  <NumberField
                    label="Mean time to repair"
                    value={config.breakdowns.mttrMs}
                    onChange={(n) => {
                      setConfig((c) => ({
                        ...c,
                        breakdowns: { ...c.breakdowns, mttrMs: Math.max(1, Math.floor(n)) },
                      }));
                    }}
                    min={100}
                    step={500}
                    suffix="ms"
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  Steady-state availability ceiling: MTBF / (MTBF + MTTR) ={" "}
                  <span className="font-mono tabular-nums">
                    {formatNumber(
                      (config.breakdowns.mtbfMs /
                        Math.max(1, config.breakdowns.mtbfMs + config.breakdowns.mttrMs)) *
                        100,
                      1,
                    )}
                    %
                  </span>
                  . Parts in flight at the moment of breakdown are scrapped (Phase 0).
                </p>
              </>
            ) : null}
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
        <section className="space-y-3" data-testid="run-results">
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
          {/* VROL-750 — cycle-time stats line so RunPage matches /editor results. */}
          {(() => {
            const cs = cycleStats(result);
            if (cs.meanMs === 0) return null;
            return (
              <p className="text-muted-foreground text-xs">
                Median cycle {formatNumber(cs.medianMs, 0)} ms · mean {formatNumber(cs.meanMs, 0)}{" "}
                ms · min {formatNumber(cs.minMs, 0)} ms · max {formatNumber(cs.maxMs, 0)} ms
              </p>
            );
          })()}

          <Card>
            <CardHeader>
              <CardTitle className="font-heading flex items-center gap-2 text-base">
                <Award className="h-4 w-4" />
                OEE per station
              </CardTitle>
              <CardDescription>
                Availability × Performance × Quality. Line OEE (geometric mean):{" "}
                <span className="font-mono tabular-nums">
                  {formatNumber(result.lineOee * 100, 1)}%
                </span>
                . Aggregate inter-buffer WIP:{" "}
                <span className="font-mono tabular-nums">
                  {formatNumber(result.aggregateBufferWipL, 2)}
                </span>{" "}
                parts (time-weighted).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-muted-foreground border-border border-b text-left text-xs tracking-wide uppercase">
                      <th className="py-2 pr-3 font-medium">Station</th>
                      <th className="px-3 py-2 text-right font-medium">A</th>
                      <th className="px-3 py-2 text-right font-medium">P</th>
                      <th className="px-3 py-2 text-right font-medium">Q</th>
                      <th className="py-2 pl-3 text-right font-medium">OEE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.perStationOee.map((m, i) => {
                      const label = `${STATION_BASE_LABELS[i] ?? `Station ${String(i + 1)}`} (${String(config.cycleTimes[i])}ms)`;
                      return (
                        <tr key={i} className="border-border/50 border-b last:border-0">
                          <td className="py-2 pr-3">{label}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatNumber(m.availability * 100, 1)}%
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatNumber(m.performance * 100, 1)}%
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatNumber(m.quality * 100, 1)}%
                          </td>
                          <td className="py-2 pl-3 text-right font-mono font-semibold tabular-nums">
                            {formatNumber(m.oee * 100, 1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                A = Running / (Running + Down). P = (idealCycle × goodParts) / Running. Q = good /
                total. Phase 0 chain has no breakdowns + zero defect rate, so A and Q are 1.0 — P
                moves with throughput, exposing line balance.
              </p>
            </CardContent>
          </Card>

          {result.perStationBreakdowns ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2 text-base">
                  <Wrench className="h-4 w-4" />
                  Breakdowns
                </CardTitle>
                <CardDescription>
                  {result.perStationBreakdowns.reduce((a, b) => a + b, 0)} total breakdown
                  {result.perStationBreakdowns.reduce((a, b) => a + b, 0) === 1 ? "" : "s"} across
                  the chain. Each fired at currentTime + sample(MTBF); repair scheduled at failure +
                  sample(MTTR).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.perStationBreakdowns.map((count, i) => {
                    const label = `${STATION_BASE_LABELS[i] ?? `Station ${String(i + 1)}`} (${String(config.cycleTimes[i])}ms)`;
                    const max = Math.max(...result.perStationBreakdowns!, 1);
                    const pct = (count / max) * 100;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground/80">{label}</span>
                          <span className="font-mono tabular-nums">
                            {count.toLocaleString()} breakdowns
                          </span>
                        </div>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                          <div
                            className="bg-sim-down h-full rounded-full transition-[width]"
                            style={{ width: `${String(pct)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {result.materialFinal ? (
            <Card>
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2 text-base">
                  <Package className="h-4 w-4" />
                  Materials
                </CardTitle>
                <CardDescription>
                  Per-material consumption + replenishment outcome.{" "}
                  {result.replenishmentsFired !== undefined && result.replenishmentsFired > 0
                    ? `${String(result.replenishmentsFired)} replenishment${
                        result.replenishmentsFired === 1 ? "" : "s"
                      } fired.`
                    : "No replenishments fired."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {result.materialFinal.map(([id, finalQty]) => {
                    const label =
                      id === BOTTLES_ID ? "Bottles" : id === CAPS_ID ? "Caps" : String(id);
                    const startQty =
                      id === BOTTLES_ID ? config.materials.bottles : config.materials.caps;
                    const replenished =
                      id === BOTTLES_ID && config.materials.replenishment.enabled
                        ? config.materials.replenishment.amount
                        : 0;
                    const consumed = startQty + replenished - finalQty;
                    const pctLeft =
                      startQty + replenished > 0 ? (finalQty / (startQty + replenished)) * 100 : 0;
                    const depleted = finalQty === 0;
                    return (
                      <div key={String(id)} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-foreground/80">
                            {label}{" "}
                            {depleted ? (
                              <span className="bg-sim-starved text-sim-starved-foreground ml-1 rounded-full px-2 py-0.5 text-xs font-medium">
                                depleted
                              </span>
                            ) : null}
                          </span>
                          <span className="font-mono tabular-nums">
                            {finalQty.toLocaleString()} /{" "}
                            {(startQty + replenished).toLocaleString()}
                          </span>
                        </div>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                          <div
                            className={`h-full rounded-full transition-[width] ${depleted ? "bg-sim-starved" : "bg-sim-running"}`}
                            style={{ width: `${String(Math.max(pctLeft, 0))}%` }}
                          />
                        </div>
                        <p className="text-muted-foreground text-xs">
                          Consumed{" "}
                          <span className="font-mono tabular-nums">
                            {consumed.toLocaleString()}
                          </span>
                          {replenished > 0 ? (
                            <>
                              {" "}
                              · Replenished{" "}
                              <span className="font-mono tabular-nums">
                                {replenished.toLocaleString()}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}

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
        <EmptyState
          icon={Play}
          title="No results yet"
          body="Set your horizon, warmup, and station cycle times, then press Run simulation."
        />
      )}
    </div>
  );
}
