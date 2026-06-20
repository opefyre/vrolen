/**
 * VROL-734 — deterministic 32-bit hash of a scenario (nodes + edges +
 * settings). Used as a stable identity for run-history entries so two
 * functionally-equal scenarios collide even if their JSON key order differs.
 *
 * Algorithm: FNV-1a over the canonical JSON of the input. Cheap, no deps.
 */

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const keys = Object.keys(value as Record<string, unknown>).sort();
    for (const k of keys) out[k] = canonical((value as Record<string, unknown>)[k]);
    return out;
  }
  return value;
}

export function digest(payload: unknown): string {
  const s = JSON.stringify(canonical(payload));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
