/**
 * VROL-676 — /help glossary of every KPI and term used in the results panel.
 * Linked from the results header so users can look up what "Line OEE" means
 * without leaving the app.
 */

import { Activity, Award, Gauge, Layers, Timer, Wrench } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface Term {
  readonly icon: typeof Gauge;
  readonly title: string;
  readonly definition: string;
  readonly formula?: string;
}

const KPI_TERMS: readonly Term[] = [
  {
    icon: Layers,
    title: "Completed parts",
    definition:
      "Number of finished parts that exited the line during the measurement window (after warmup).",
  },
  {
    icon: Gauge,
    title: "Throughput (λ)",
    definition: "Average parts produced per unit time. Reported per hour and per second.",
    formula: "completed / measurement window",
  },
  {
    icon: Activity,
    title: "Average WIP (L)",
    definition:
      "Time-weighted average count of in-process parts: parts sitting in inter-station buffers plus parts being worked on.",
  },
  {
    icon: Timer,
    title: "Time-in-system (W)",
    definition:
      "Average time a finished part spent in the line, from arrival at the first station to exit. Little's Law: L = λW.",
  },
  {
    icon: Award,
    title: "Line OEE",
    definition:
      "Overall Equipment Effectiveness for the whole line. Actual throughput divided by the theoretical maximum, clamped to ≤ 100%.",
    formula: "actual throughput / theoretical max",
  },
  {
    icon: Award,
    title: "Per-station OEE",
    definition:
      "Availability × Performance × Quality at the station level. The slim factor is the lever you can pull.",
    formula: "A × P × Q",
  },
  {
    icon: Wrench,
    title: "Bottleneck",
    definition:
      "The station with the highest Running %. Its rate caps the entire line — speeding up any other station won't help.",
  },
];

const STATE_TERMS: readonly { readonly name: string; readonly definition: string }[] = [
  {
    name: "Running",
    definition:
      "Station is actively processing a part. Higher Running % usually means a tighter bottleneck.",
  },
  {
    name: "Starved",
    definition:
      "Station has capacity but no upstream part to work on. Upstream is too slow or the buffer ran dry.",
  },
  {
    name: "Blocked",
    definition: "Station finished a part but can't push it downstream — the next buffer is full.",
  },
  {
    name: "Down",
    definition: "Station is broken (MTBF/MTTR breakdown). Counts as unplanned downtime in OEE.",
  },
  {
    name: "Setup",
    definition: "Changeover between products. Counts against Performance, not Availability.",
  },
  {
    name: "Maintenance",
    definition: "Planned preventive maintenance. Excluded from OEE Availability.",
  },
  { name: "Idle", definition: "Station is outside its scheduled shift or is off-shift." },
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Glossary</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          KPI definitions and station states used across the simulator.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">KPIs</CardTitle>
          <CardDescription>What every number in the results panel means.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4">
            {KPI_TERMS.map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.title} className="flex gap-3">
                  <Icon className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div className="space-y-1">
                    <dt className="text-sm font-semibold">{t.title}</dt>
                    <dd className="text-foreground/80 text-sm leading-relaxed">{t.definition}</dd>
                    {t.formula ? (
                      <code className="bg-muted inline-block rounded px-1.5 py-0.5 text-xs">
                        {t.formula}
                      </code>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Station states</CardTitle>
          <CardDescription>What each colored band in the state Pareto means.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            {STATE_TERMS.map((s) => (
              <div key={s.name}>
                <dt className="text-sm font-semibold">{s.name}</dt>
                <dd className="text-foreground/80 text-sm">{s.definition}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
