/**
 * Landing page (VROL-629).
 *
 * Replaces the placeholder "Hello Vrolen" smoke test with a real first
 * impression: hero + animated topology SVG + three feature cards + four
 * preset chips that route to /editor with the named preset pre-loaded.
 *
 * Hand-rolled SVG hero. No new dependencies.
 */

import { ArrowRight, Activity, GitBranch, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PRESETS, setPendingPreset } from "@/lib/presets";

function HeroFlow() {
  // Three-station mini chain with two animated dots flowing along the bezier.
  // Pure SVG via <animateMotion>, same primitive AnimatedEdge uses.
  const path1 = "M 60 100 C 130 100 170 100 220 100";
  const path2 = "M 240 100 C 310 100 350 100 400 100";
  return (
    <svg
      viewBox="0 0 460 200"
      className="text-sim-running mx-auto h-40 w-full max-w-md"
      role="img"
      aria-label="A three-station chain with parts flowing between stations"
    >
      <defs>
        <path id="hero-edge-1" d={path1} fill="none" />
        <path id="hero-edge-2" d={path2} fill="none" />
      </defs>
      {/* Edges */}
      <path d={path1} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} fill="none" />
      <path d={path2} stroke="currentColor" strokeOpacity={0.35} strokeWidth={1.5} fill="none" />
      {/* Stations */}
      {[
        { x: 60, y: 100, label: "Filler" },
        { x: 230, y: 100, label: "Capper" },
        { x: 400, y: 100, label: "Packer" },
      ].map((s) => (
        <g key={s.label}>
          <rect
            x={s.x - 28}
            y={s.y - 18}
            width={56}
            height={36}
            rx={6}
            className="fill-card stroke-border"
            strokeWidth={1.5}
          />
          <text
            x={s.x}
            y={s.y + 4}
            textAnchor="middle"
            className="fill-foreground"
            style={{ fontSize: 11, fontWeight: 500 }}
          >
            {s.label}
          </text>
        </g>
      ))}
      {/* Animated dots */}
      {[0, 1].map((i) => (
        <circle key={`d1-${String(i)}`} r={4} fill="currentColor">
          <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${String(i * 1.25)}s`}>
            <mpath href="#hero-edge-1" />
          </animateMotion>
        </circle>
      ))}
      {[0, 1].map((i) => (
        <circle key={`d2-${String(i)}`} r={4} fill="currentColor">
          <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${String(i * 1.25)}s`}>
            <mpath href="#hero-edge-2" />
          </animateMotion>
        </circle>
      ))}
    </svg>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Activity;
  title: string;
  body: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-5 shadow-sm">
      <div className="bg-sim-running/10 text-sim-running mb-3 flex h-9 w-9 items-center justify-center rounded-md">
        <Icon className="h-5 w-5" />
      </div>
      <div className="font-heading text-base font-semibold">{title}</div>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

export default function LandingPage() {
  const goToEditor = (presetId?: string) => {
    if (presetId) setPendingPreset(presetId);
    if (typeof window !== "undefined") window.location.href = "/editor";
  };

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-12">
      {/* Hero */}
      <section className="space-y-6 text-center">
        <div className="bg-sim-running/10 text-sim-running mx-auto inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium">
          <span className="bg-sim-running h-1.5 w-1.5 animate-pulse rounded-full" />
          Discrete-event production-line simulator
        </div>
        <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
          Model your line, find the bottleneck.
        </h1>
        <p className="text-muted-foreground mx-auto max-w-2xl text-base sm:text-lg">
          Vrolen runs a deterministic discrete-event simulation over a station-and-edge graph,
          surfaces throughput, OEE, buffer fill, and worker utilization over time — and tells you
          where the constraint really is.
        </p>
        <HeroFlow />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            className="gap-2"
            onClick={() => {
              goToEditor();
            }}
          >
            Open the editor
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              goToEditor("bottling-line");
            }}
          >
            Load the bottling demo
          </Button>
        </div>
      </section>

      {/* Feature cards */}
      <section className="grid gap-4 sm:grid-cols-3">
        <FeatureCard
          icon={GitBranch}
          title="Model the line"
          body="Drag stations onto a canvas, wire them as a DAG. Branching paths, parallel fillers, rework loops back upstream — all first-class."
        />
        <FeatureCard
          icon={Settings2}
          title="Configure realism"
          body="Per-station cycle distributions, defect rates, setup + changeover, breakdowns, planned maintenance, workers with shifts + breaks."
        />
        <FeatureCard
          icon={Activity}
          title="Watch what happens"
          body="Throughput-over-time, bottleneck state-mix charts, per-station sparklines, edge buffer-fill, scenario comparison, samples-mode CSV."
        />
      </section>

      {/* Presets */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-heading text-xl font-semibold">Try a preset</h2>
          <span className="text-muted-foreground text-xs">
            One click → editor, fully configured.
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                goToEditor(preset.id);
              }}
              className="border-border bg-card hover:border-foreground/30 group flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors"
              aria-label={`Load preset ${preset.title}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">{preset.title}</span>
                <ArrowRight className="text-muted-foreground group-hover:text-foreground h-4 w-4 transition-colors" />
              </div>
              <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {preset.highlight}
              </span>
              <span className="text-muted-foreground text-sm leading-relaxed">{preset.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-border text-muted-foreground flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-6 text-xs">
        <a href="/editor" className="hover:text-foreground">
          /editor
        </a>
        <a href="/run" className="hover:text-foreground">
          /run
        </a>
        <a href="/design-tokens" className="hover:text-foreground">
          /design-tokens
        </a>
        <span>—</span>
        <span>Phase 0 portfolio build</span>
      </footer>
    </div>
  );
}
