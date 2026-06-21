import type { Distribution } from "@/engine";

const DISTRIBUTION_KINDS = new Set<string>([
  "constant",
  "uniform",
  "normal",
  "triangular",
  "exponential",
  "lognormal",
  "weibull",
  "gamma",
  "empirical",
]);

export function isDistribution(v: unknown): v is Distribution {
  if (!v || typeof v !== "object") return false;
  const kind = (v as { kind?: unknown }).kind;
  return typeof kind === "string" && DISTRIBUTION_KINDS.has(kind);
}

// Engine StateTimeTracker requires integer-millisecond cycle times — fractional
// ms breaks the time-ordering invariant. Round time-domain params to whole ms.
const r = (n: number): number => Math.max(1, Math.round(n));

export function scaleDistribution(d: Distribution, k: number): Distribution {
  if (k === 1) return d;
  switch (d.kind) {
    case "constant":
      return { kind: "constant", value: r(d.value * k) };
    case "uniform":
      return { kind: "uniform", min: r(d.min * k), max: r(d.max * k) };
    case "normal":
      return { kind: "normal", mean: r(d.mean * k), stddev: r(d.stddev * k) };
    case "triangular":
      return {
        kind: "triangular",
        min: r(d.min * k),
        mode: r(d.mode * k),
        max: r(d.max * k),
      };
    case "exponential":
      return { kind: "exponential", rate: d.rate / k };
    case "lognormal":
      return { kind: "lognormal", mu: d.mu + Math.log(k), sigma: d.sigma };
    case "weibull":
      return { kind: "weibull", shape: d.shape, scale: r(d.scale * k) };
    case "gamma":
      return { kind: "gamma", shape: d.shape, scale: r(d.scale * k) };
    case "empirical":
      return { kind: "empirical", values: d.values.map((v) => r(v * k)) };
  }
}

export function meanOfDistribution(d: Distribution): number {
  switch (d.kind) {
    case "constant":
      return d.value;
    case "uniform":
      return (d.min + d.max) / 2;
    case "normal":
      return d.mean;
    case "triangular":
      return (d.min + d.mode + d.max) / 3;
    case "exponential":
      return d.rate > 0 ? 1 / d.rate : 0;
    case "lognormal":
      return Math.exp(d.mu + (d.sigma * d.sigma) / 2);
    case "weibull":
      return d.scale;
    case "gamma":
      return d.shape * d.scale;
    case "empirical": {
      if (d.values.length === 0) return 0;
      let s = 0;
      for (const v of d.values) s += v;
      return s / d.values.length;
    }
  }
}
