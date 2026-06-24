/**
 * VROL-975 — compact SVG histogram of one station's sampled cycle
 * times. ~20 equal-width bins. Min/median/max overlay rules so the
 * shape and the headline scalars sit next to each other.
 *
 * Pure render — no chart lib. The audit explicitly flagged "min/median/max
 * scalars hide bimodality" as a UX gap; this is the cheap fix.
 */

const W = 240;
const H = 48;
const BINS = 20;

interface Props {
  readonly samples: readonly number[];
}

export function CycleHistogram({ samples }: Props) {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const lo = sorted[0]!;
  const hi = sorted[sorted.length - 1]!;
  if (hi <= lo) return null;
  const span = hi - lo;
  const bins = new Array<number>(BINS).fill(0);
  for (const v of samples) {
    const idx = Math.min(BINS - 1, Math.max(0, Math.floor(((v - lo) / span) * BINS)));
    bins[idx] = (bins[idx] ?? 0) + 1;
  }
  const peak = Math.max(1, ...bins);
  const barW = W / BINS;
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const medianX = ((median - lo) / span) * W;
  const fmtMs = (n: number): string => `${Math.round(n).toLocaleString()} ms`;
  return (
    <div className="space-y-1" data-testid="cycle-histogram">
      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
        <span>Sampled cycle times ({samples.length.toLocaleString()})</span>
        <span className="font-mono tabular-nums">
          {fmtMs(lo)} · {fmtMs(median)} · {fmtMs(hi)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        width={W}
        height={H}
        role="img"
        aria-label={`Cycle-time histogram, ${String(samples.length)} samples`}
      >
        {bins.map((count, i) => {
          const h = (count / peak) * (H - 2);
          return (
            <rect
              key={i}
              x={i * barW + 0.5}
              y={H - h}
              width={Math.max(0.5, barW - 1)}
              height={h}
              fill="var(--sim-running, oklch(0.7 0.18 145))"
              opacity={0.75}
            />
          );
        })}
        <line
          x1={medianX}
          x2={medianX}
          y1={0}
          y2={H}
          stroke="var(--foreground, currentColor)"
          strokeWidth={0.75}
          strokeDasharray="2 2"
        />
      </svg>
    </div>
  );
}
