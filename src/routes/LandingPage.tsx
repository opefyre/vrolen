/**
 * Landing page (VROL-629).
 *
 * Replaces the placeholder "Hello Vrolen" smoke test with a real first
 * impression: hero + animated topology SVG + three feature cards + four
 * preset chips that route to /editor with the named preset pre-loaded.
 *
 * Hand-rolled SVG hero. No new dependencies.
 */

import { ArrowRight, Activity, ExternalLink, GitBranch, Settings2, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { commitDraft } from "@/components/wizard/commit-draft";
import { WizardShell } from "@/components/wizard/wizard-shell";
import { PRESETS, setPendingPreset } from "@/lib/presets";
import { setPendingWizardCommit } from "@/lib/wizard-handoff";
import { TopologyPreview } from "@/components/landing/topology-preview";

/** VROL-707 — derive a coarse category from preset id so cards can show a tag. */
function presetCategory(id: string): { label: string; tone: string } {
  if (id.includes("bottling") || id.includes("pharma") || id.includes("bakery")) {
    return { label: "Process", tone: "bg-sim-running/15 text-sim-running" };
  }
  if (id.includes("worker") || id.includes("labor")) {
    return { label: "Labor", tone: "bg-sim-setup/15 text-sim-setup-foreground" };
  }
  if (id.includes("maintenance") || id.includes("breakdown")) {
    return { label: "Reliability", tone: "bg-sim-down/15 text-sim-down-foreground" };
  }
  if (id.includes("changeover") || id.includes("job-shop") || id.includes("mixed")) {
    return { label: "Mix", tone: "bg-sim-blocked/15 text-sim-blocked-foreground" };
  }
  if (id.includes("parallel") || id.includes("two-line") || id.includes("electronics")) {
    return { label: "Topology", tone: "bg-sim-maintenance/15 text-sim-maintenance-foreground" };
  }
  return { label: "Demo", tone: "bg-muted text-muted-foreground" };
}

/** VROL-706 — count up to N over ~600ms. Lightweight CSS-free counter. */
function useCountUp(target: number, durationMs = 600): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs);
      setV(Math.round(k * target));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [target, durationMs]);
  return v;
}

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

function HeroStats() {
  const presets = useCountUp(PRESETS.length);
  const stations = useCountUp(10);
  return (
    <div className="mx-auto grid max-w-xs grid-cols-2 gap-3 text-center">
      <Stat value={presets} label="presets" />
      <Stat value={stations} label="station types" />
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-heading text-foreground text-2xl font-bold tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-muted-foreground mt-0.5 text-xs tracking-wide uppercase">{label}</div>
    </div>
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
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
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
        {/* VROL-706 — animated stat counters anchored below the hero. */}
        <HeroStats />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button
            size="lg"
            className="gap-2"
            onClick={() => {
              setWizardOpen(true);
            }}
          >
            <Wand2 className="h-4 w-4" />
            Create scenario
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => {
              goToEditor();
            }}
            className="gap-2"
          >
            Open the editor
            <ArrowRight className="h-4 w-4" />
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={() => {
              goToEditor("bottling-line");
            }}
          >
            Load the bottling demo
          </Button>
          {/* VROL-437 — /demo is a one-click external entry point. */}
          <Button
            size="lg"
            variant="ghost"
            onClick={() => {
              if (typeof window !== "undefined") window.location.href = "/templates";
            }}
          >
            Browse templates
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
          <h2 className="font-heading flex items-center gap-2 text-xl font-semibold">
            Try a preset
            {/* VROL-760 — count badge. */}
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium">
              {PRESETS.length}
            </span>
          </h2>
          <span className="text-muted-foreground text-xs">
            One click → editor, fully configured.
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                goToEditor(preset.id);
              }}
              className="border-border bg-card hover:border-foreground/30 group flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors"
              aria-label={`Load preset ${preset.title}`}
            >
              {/* VROL-666 — topology preview */}
              <div className="bg-background/40 border-border rounded-md border">
                <TopologyPreview nodes={preset.graph.nodes} edges={preset.graph.edges} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-heading text-sm font-semibold">{preset.title}</span>
                <ArrowRight className="text-muted-foreground group-hover:text-foreground h-4 w-4 transition-colors" />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {/* VROL-707 — category badge. */}
                <span
                  className={`${presetCategory(preset.id).tone} rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase`}
                >
                  {presetCategory(preset.id).label}
                </span>
                <span className="bg-sim-running/15 text-sim-running rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                  {preset.highlight}
                </span>
              </div>
              <span className="text-muted-foreground text-xs leading-relaxed">{preset.blurb}</span>
            </button>
          ))}
        </div>
      </section>

      <footer className="border-border text-muted-foreground flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t pt-6 text-xs">
        <a href="/editor" className="hover:text-foreground">
          Editor
        </a>
        <a href="/run" className="hover:text-foreground">
          Run logs
        </a>
        <a href="/help" className="hover:text-foreground">
          Help &amp; shortcuts
        </a>
        <a href="/design-tokens" className="hover:text-foreground">
          Design tokens
        </a>
        <a
          href="https://github.com/opefyre/vrolen"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground inline-flex items-center gap-1"
        >
          Source <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
      <WizardShell
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
        }}
        onFinish={(draft, mode) => {
          const commit = commitDraft(draft);
          setPendingWizardCommit({
            nodes: commit.nodes,
            edges: commit.edges,
            settingsPatch: commit.settingsPatch,
            autorun: mode === "run",
          });
          if (typeof window !== "undefined") window.location.href = "/editor";
        }}
      />
    </div>
  );
}
