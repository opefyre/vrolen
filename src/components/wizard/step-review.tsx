/**
 * VROL-820 — review step preview card.
 *
 * Renders a two-column summary card:
 *   - Left: thumbnail-style summary lines (station count, products,
 *     arrival rate, realism) with a "Tweak section" jump link next to
 *     each line that takes the user back to the relevant step.
 *   - Right: a compact SVG mini-DAG (N circles in a row joined by
 *     arrows) sized to ~200x80, themed via the `--primary`,
 *     `--muted-foreground`, and `--border` CSS vars so it follows the
 *     light/dark theme.
 */

import { Pencil } from "lucide-react";

import type { WizardDraft } from "./wizard-types";

function fmtHorizon(ms: number): string {
  const h = ms / (60 * 60 * 1000);
  if (h < 1) return `${(ms / (60 * 1000)).toFixed(0)} min`;
  if (h < 24) return `${h.toFixed(0)} hours`;
  return `${(h / 24).toFixed(0)} days`;
}

function realismLabel(level: WizardDraft["realism"]): string {
  switch (level) {
    case "simple":
      return "Simple";
    case "realistic":
      return "Realistic";
    case "stress":
      return "Stress";
  }
}

interface ReviewLineSpec {
  readonly label: string;
  readonly value: string;
  /** Step index to jump back to when the user clicks "Tweak section". */
  readonly stepIdx: 0 | 1 | 2 | 3;
  readonly testId: string;
}

export function StepReview({
  draft,
  onJump,
}: {
  readonly draft: WizardDraft;
  readonly onJump: (idx: number) => void;
}) {
  const productCount = countProducts(draft);
  const arrivalRatePerHour = Math.round(draft.arrivalsPerMin * 60);
  const lines: readonly ReviewLineSpec[] = [
    {
      label: "Station count",
      value: String(draft.stations.length),
      stepIdx: 1,
      testId: "review-stations",
    },
    {
      label: "Products",
      value: String(productCount),
      stepIdx: 0,
      testId: "review-products",
    },
    {
      label: "Arrival rate",
      value: `${String(arrivalRatePerHour)}/h`,
      stepIdx: 2,
      testId: "review-arrivals",
    },
    {
      label: "Run length",
      value: fmtHorizon(draft.horizonMs),
      stepIdx: 2,
      testId: "review-horizon",
    },
    {
      label: "Realism",
      value: realismLabel(draft.realism),
      stepIdx: 3,
      testId: "review-realism",
    },
  ];
  return (
    <div className="space-y-3">
      <p className="text-foreground/80 text-sm">
        Hit <strong>Run simulation</strong> and we&rsquo;ll show you throughput, bottlenecks, and
        OEE in about 2 seconds.
      </p>
      <div className="border-border bg-background/40 grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            Summary
          </div>
          <ul className="divide-border divide-y">
            {lines.map((line) => (
              <li
                key={line.label}
                data-testid={line.testId}
                className="flex items-center justify-between gap-3 py-1.5 text-sm"
              >
                <span className="text-muted-foreground">{line.label}</span>
                <span className="flex items-center gap-2">
                  <span className="text-foreground font-mono tabular-nums">{line.value}</span>
                  <button
                    type="button"
                    onClick={() => {
                      onJump(line.stepIdx);
                    }}
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-[11px] underline-offset-2 hover:underline"
                    aria-label={`Tweak ${line.label.toLowerCase()}`}
                  >
                    <Pencil className="h-2.5 w-2.5" aria-hidden />
                    Tweak section
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-center sm:justify-end">
          <MiniDag count={draft.stations.length} />
        </div>
      </div>
    </div>
  );
}

/**
 * "Products" is a rough proxy for distinct product types in the line.
 * The wizard doesn't model multi-product flows directly, so today we
 * use 1 unless the user has explicitly added differently-typed stations.
 * Counting unique stationType keys keeps the value meaningful for the
 * preset variations and degrades gracefully to 1 for the blank shape.
 */
function countProducts(draft: WizardDraft): number {
  const types = new Set<string>();
  draft.stations.forEach((s) => {
    types.add(s.stationType);
  });
  return Math.max(1, types.size);
}

/**
 * VROL-820 — compact left-to-right DAG diagram. N circles, each linked
 * by an arrow. Colors use CSS vars so the SVG themes with the rest of
 * the app:
 *   - circle fill: var(--primary)
 *   - circle stroke: var(--border)
 *   - arrow stroke: var(--muted-foreground)
 *
 * Sizing: 200 wide × 80 tall. We clamp display to a max of 6 nodes so
 * the diagram never overflows; longer chains show "+N" on the trailing
 * node to communicate the truncation.
 */
function MiniDag({ count }: { readonly count: number }) {
  const width = 200;
  const height = 80;
  const maxNodes = 6;
  const shown = Math.min(Math.max(1, count), maxNodes);
  const overflow = Math.max(0, count - maxNodes);
  const padding = 16;
  const innerWidth = width - padding * 2;
  const step = shown === 1 ? 0 : innerWidth / (shown - 1);
  const cy = height / 2;
  const radius = 10;
  return (
    <svg
      role="img"
      aria-label={`Mini topology with ${String(count)} ${count === 1 ? "station" : "stations"}`}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      className="block"
    >
      <defs>
        <marker
          id="vrolen-wizard-dag-arrow"
          viewBox="0 0 8 8"
          refX={6}
          refY={4}
          markerWidth={6}
          markerHeight={6}
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
      {Array.from({ length: shown - 1 }).map((_, i) => {
        const x1 = padding + step * i + radius;
        const x2 = padding + step * (i + 1) - radius;
        return (
          <line
            key={`edge-${String(i)}`}
            x1={x1}
            y1={cy}
            x2={x2}
            y2={cy}
            stroke="var(--muted-foreground)"
            strokeWidth={1.5}
            markerEnd="url(#vrolen-wizard-dag-arrow)"
          />
        );
      })}
      {Array.from({ length: shown }).map((_, i) => {
        const cx = padding + step * i;
        const isLast = i === shown - 1;
        const label = isLast && overflow > 0 ? `+${String(overflow)}` : String(i + 1);
        return (
          <g key={`node-${String(i)}`}>
            <circle
              cx={cx}
              cy={cy}
              r={radius}
              fill="var(--primary)"
              stroke="var(--border)"
              strokeWidth={1.5}
            />
            <text
              x={cx}
              y={cy + 3}
              textAnchor="middle"
              fontSize={9}
              fontWeight={600}
              fill="var(--primary-foreground)"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
