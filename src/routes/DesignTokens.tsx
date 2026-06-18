/**
 * /design-tokens — debug route showing every design token at a glance.
 *
 * Helpful for: contrast checking, dark-mode parity verification, and giving
 * everyone (you, future contributors, AI) a single page that proves "all the
 * tokens exist and look like they should." If something looks broken here, it's
 * broken everywhere.
 */

type SimState = "idle" | "setup" | "running" | "blocked" | "starved" | "down" | "maintenance";

const SIM_STATES: { key: SimState; label: string }[] = [
  { key: "idle", label: "Idle" },
  { key: "setup", label: "Setup" },
  { key: "running", label: "Running" },
  { key: "blocked", label: "BlockedOut" },
  { key: "starved", label: "Starved" },
  { key: "down", label: "Down" },
  { key: "maintenance", label: "Maintenance" },
];

const SHADCN_PAIRS: { bg: string; fg: string; label: string }[] = [
  { bg: "bg-background", fg: "text-foreground", label: "background / foreground" },
  { bg: "bg-card", fg: "text-card-foreground", label: "card" },
  { bg: "bg-popover", fg: "text-popover-foreground", label: "popover" },
  { bg: "bg-primary", fg: "text-primary-foreground", label: "primary" },
  { bg: "bg-secondary", fg: "text-secondary-foreground", label: "secondary" },
  { bg: "bg-muted", fg: "text-muted-foreground", label: "muted" },
  { bg: "bg-accent", fg: "text-accent-foreground", label: "accent" },
  { bg: "bg-destructive", fg: "text-primary-foreground", label: "destructive" },
];

function Swatch({ bgClass, fgClass, label }: { bgClass: string; fgClass: string; label: string }) {
  return (
    <div
      className={`${bgClass} ${fgClass} border-border flex flex-col gap-1 rounded-md border p-3 text-sm`}
    >
      <span className="font-mono text-xs opacity-70">{bgClass}</span>
      <span className="font-medium">{label}</span>
      <span className="opacity-70">Aa Bb Cc 0123</span>
    </div>
  );
}

export default function DesignTokens() {
  return (
    <main className="bg-background text-foreground min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <header className="space-y-2">
          <h1 className="font-heading text-3xl font-bold tracking-tight">Design tokens</h1>
          <p className="text-muted-foreground text-sm">
            Single-page audit of every theme color. If anything reads poorly, the token is wrong.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight">Typography</h2>
          <div className="space-y-2">
            <p className="font-heading text-4xl">Geist Variable — heading</p>
            <p className="font-sans text-base">
              Geist Variable — body sans (used for most UI text and labels).
            </p>
            <p className="font-mono text-sm">
              JetBrains Mono Variable — used for numbers, KPIs, and code-like values.
            </p>
            <p className="font-mono text-2xl tabular-nums">
              0123456789 · throughput 4,238/hr · OEE 0.842
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            shadcn / surface tokens
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {SHADCN_PAIRS.map((p) => (
              <Swatch key={p.label} bgClass={p.bg} fgClass={p.fg} label={p.label} />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight">
            Simulation state colors
          </h2>
          <p className="text-muted-foreground text-sm">
            Used by station rings on the canvas, badges in dashboards, and AI narration accents.
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
            {SIM_STATES.map((s) => (
              <Swatch
                key={s.key}
                bgClass={`bg-sim-${s.key}`}
                fgClass={`text-sim-${s.key}-foreground`}
                label={s.label}
              />
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold tracking-tight">Radius scale</h2>
          <div className="flex flex-wrap gap-3">
            {(["sm", "md", "lg", "xl", "2xl", "3xl"] as const).map((r) => (
              <div
                key={r}
                className={`bg-primary text-primary-foreground rounded-${r} flex h-16 w-24 items-center justify-center text-sm font-medium`}
              >
                {r}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
