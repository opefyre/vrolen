/**
 * VROL-951 — tiny SVG mini-chart of a Distribution's shape. Renders next
 * to the cycle-time field in the inspector so users see "this is a
 * normal distribution with these tails" rather than just numeric params.
 *
 * Pure rendering helper; samples the PDF at 60 points across a sensible
 * window per distribution kind. No tooltips, no axis labels — it's a
 * shape indicator, not a chart.
 */

import type { Distribution } from "@/engine";

const W = 120;
const H = 28;
const POINTS = 60;

interface PolylineSpec {
  readonly points: string;
  readonly viewBox: string;
}

function build(values: readonly number[]): PolylineSpec {
  const maxY = Math.max(1, ...values);
  const minY = 0;
  const stepX = W / Math.max(1, values.length - 1);
  const pts = values.map((y, i) => {
    const px = (i * stepX).toFixed(1);
    const py = (H - ((y - minY) / (maxY - minY)) * H).toFixed(1);
    return `${px},${py}`;
  });
  return { points: pts.join(" "), viewBox: `0 0 ${String(W)} ${String(H)}` };
}

function pdfFor(d: Distribution): number[] {
  switch (d.kind) {
    case "constant": {
      // Vertical spike at the value.
      const out = new Array<number>(POINTS).fill(0);
      out[Math.floor(POINTS / 2)] = 1;
      return out;
    }
    case "uniform": {
      // Box from min..max.
      return new Array<number>(POINTS).fill(1);
    }
    case "normal": {
      // Sample N(0, 1) shape; the mean+stddev shift/scale doesn't change
      // the visual outline.
      const out: number[] = [];
      for (let i = 0; i < POINTS; i++) {
        const z = -3 + (i / (POINTS - 1)) * 6;
        out.push(Math.exp(-(z * z) / 2));
      }
      return out;
    }
    case "truncatedNormal": {
      // VROL-976 — Normal shape zero-clipped outside [min, max].
      const out: number[] = [];
      const span = Math.max(1e-9, d.max - d.min);
      for (let i = 0; i < POINTS; i++) {
        const x = d.min + (i / (POINTS - 1)) * span;
        const z = (x - d.mean) / Math.max(1e-9, d.stddev);
        if (x < d.min || x > d.max) out.push(0);
        else out.push(Math.exp(-(z * z) / 2));
      }
      return out;
    }
    case "triangular": {
      const out: number[] = [];
      const peak = Math.floor((POINTS * (d.mode - d.min)) / Math.max(1, d.max - d.min));
      for (let i = 0; i < POINTS; i++) {
        out.push(i <= peak ? i / Math.max(1, peak) : (POINTS - i) / Math.max(1, POINTS - peak));
      }
      return out;
    }
    case "exponential": {
      // λ doesn't matter for the shape; just decay over 6 mean-lives.
      const out: number[] = [];
      for (let i = 0; i < POINTS; i++) {
        const x = (i / (POINTS - 1)) * 6;
        out.push(Math.exp(-x));
      }
      return out;
    }
    case "lognormal": {
      // Right-skewed; one peak then a long tail.
      const out: number[] = [];
      for (let i = 0; i < POINTS; i++) {
        const x = ((i + 1) / POINTS) * 5;
        out.push(Math.exp(-((Math.log(x) * Math.log(x)) / 2)) / x);
      }
      return out;
    }
    case "weibull": {
      // Family-typical shape for shape ≈ 1.5.
      const out: number[] = [];
      const shape = d.shape || 1.5;
      for (let i = 0; i < POINTS; i++) {
        const x = ((i + 1) / POINTS) * 3;
        out.push(shape * Math.pow(x, shape - 1) * Math.exp(-Math.pow(x, shape)));
      }
      return out;
    }
    case "gamma": {
      // Gamma(2, 1) — peak then tail.
      const out: number[] = [];
      for (let i = 0; i < POINTS; i++) {
        const x = ((i + 1) / POINTS) * 6;
        out.push(x * Math.exp(-x));
      }
      return out;
    }
    case "empirical": {
      // Histogram bins from the supplied samples. Equal-width binning.
      if (d.values.length === 0) return new Array<number>(POINTS).fill(0);
      const lo = Math.min(...d.values);
      const hi = Math.max(...d.values);
      const bins = new Array<number>(POINTS).fill(0);
      for (const v of d.values) {
        const bin = Math.min(
          POINTS - 1,
          Math.max(0, Math.floor(((v - lo) / Math.max(1e-9, hi - lo)) * POINTS)),
        );
        bins[bin] = (bins[bin] ?? 0) + 1;
      }
      return bins;
    }
  }
}

export function DistributionPdf({ distribution }: { distribution: Distribution }) {
  const spec = build(pdfFor(distribution));
  const labelByKind: Record<Distribution["kind"], string> = {
    constant: "Constant",
    uniform: "Uniform",
    normal: "Normal",
    truncatedNormal: "Truncated normal",
    triangular: "Triangular",
    exponential: "Exponential",
    lognormal: "Log-normal",
    weibull: "Weibull",
    gamma: "Gamma",
    empirical: "Empirical",
  };
  return (
    <svg
      viewBox={spec.viewBox}
      width={W}
      height={H}
      className="text-muted-foreground inline-block"
      role="img"
      aria-label={`${labelByKind[distribution.kind]} distribution shape`}
    >
      <polyline
        points={spec.points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
    </svg>
  );
}
