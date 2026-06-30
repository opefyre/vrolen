/**
 * VROL-1008 — minimal sanity for the glossary registry.
 *
 * The existing 15 entries from VROL-964 were never under test. This
 * file just locks in (a) lookupGlossary returns entries by key, (b)
 * known feature entries are present and well-formed, (c) unknown
 * keys return undefined.
 */
import { describe, expect, it } from "vitest";

import { GLOSSARY, lookupGlossary } from "./glossary";

describe("glossary registry", () => {
  it("every entry has a non-empty title and body", () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      expect(entry.title.length, `entry ${key} title`).toBeGreaterThan(0);
      expect(entry.body.length, `entry ${key} body`).toBeGreaterThan(0);
    }
  });

  it("lookupGlossary returns known entries", () => {
    expect(lookupGlossary("oee")?.title).toContain("OEE");
    expect(lookupGlossary("bottleneck")).toBeDefined();
    expect(lookupGlossary("warmup")).toBeDefined();
  });

  it("lookupGlossary returns undefined for unknown keys", () => {
    expect(lookupGlossary("not-a-real-key")).toBeUndefined();
    expect(lookupGlossary("")).toBeUndefined();
  });

  it("VROL-1008 — new entries for Sprints 112-118 features are registered", () => {
    expect(lookupGlossary("conveyor")?.title).toContain("Conveyor");
    expect(lookupGlossary("residence-time")?.title).toContain("Residence");
    expect(lookupGlossary("unit-of-measure")?.body).toContain("kg");
    expect(lookupGlossary("stability")?.body).toContain("CV");
  });

  it("VROL-1009 — batch-fire entry from Sprint 121 is registered", () => {
    const entry = lookupGlossary("batch-fire");
    expect(entry?.title).toContain("Batch-fire");
    expect(entry?.body).toMatch(/batchSize|build plate/i);
  });

  it("VROL-1013 — UoM entry covers both v1 (label) and v2 (ratio)", () => {
    const entry = lookupGlossary("unit-of-measure");
    expect(entry?.body).toContain("unitsPerPart");
    expect(entry?.body).toMatch(/ratio/i);
  });

  it("VROL-1024 — action-card rule terms are registered", () => {
    expect(lookupGlossary("energy-hotspot")?.title).toContain("Energy hotspot");
    expect(lookupGlossary("partial-batch")?.title).toContain("Partial-batch");
    expect(lookupGlossary("multi-plate")?.title).toMatch(/Multi-plate/i);
    expect(lookupGlossary("multi-plate")?.body).toMatch(/capacity/i);
  });

  it("VROL-1046 — capacity + Pareto terms are registered", () => {
    expect(lookupGlossary("station-capacity")?.title).toMatch(/Station capacity/);
    expect(lookupGlossary("station-capacity")?.body).toMatch(/parallel/i);
    expect(lookupGlossary("pareto-frontier")?.title).toMatch(/Pareto/);
    expect(lookupGlossary("pareto-frontier")?.body).toMatch(/dominated/i);
  });

  // ────────────────────────────────────────────────────────────────────────
  // VROL-1087 → VROL-1093 — Sprint 183 statistical / DES vocabulary.
  // ────────────────────────────────────────────────────────────────────────

  it("VROL-1087 — replication entry exists with a Law & Kelton citation", () => {
    const entry = lookupGlossary("replication");
    expect(entry?.title).toMatch(/Replication/);
    expect(entry?.body).toMatch(/seed/i);
    expect(entry?.source).toMatch(/Law.*Kelton|Kelton/i);
  });

  it("VROL-1088 — confidence-interval entry covers 95 % framing + half-width terminology", () => {
    const entry = lookupGlossary("confidence-interval");
    expect(entry?.title).toMatch(/confidence interval/i);
    expect(entry?.body).toMatch(/95/);
    expect(entry?.body).toMatch(/half-width|low,? high/i);
  });

  it("VROL-1089 — half-width entry references the 1.96 × σ/√n formula", () => {
    const entry = lookupGlossary("half-width");
    expect(entry?.title).toMatch(/Half-width/);
    expect(entry?.body).toMatch(/1\.96/);
    expect(entry?.body).toMatch(/√n|√/);
  });

  it("VROL-1090 — crn entry explains paired-seed variance reduction", () => {
    const entry = lookupGlossary("crn");
    expect(entry?.title).toMatch(/Common random numbers/i);
    expect(entry?.body).toMatch(/paired|same.*seed|seed.*pair/i);
    expect(entry?.body).toMatch(/sensitivity|optimization/i);
  });

  it("VROL-1091 — bessel-correction entry explains n−1 vs n", () => {
    const entry = lookupGlossary("bessel-correction");
    expect(entry?.title).toMatch(/Bessel/i);
    expect(entry?.body).toMatch(/n − 1|n - 1|n−1|n-1/);
    expect(entry?.body).toMatch(/sample|population/i);
  });

  it("VROL-1092 — sensitivity-sweep entry describes the 4 dimensions", () => {
    const entry = lookupGlossary("sensitivity-sweep");
    expect(entry?.title).toMatch(/Sensitivity sweep/i);
    expect(entry?.body).toMatch(/tornado|swing/i);
    expect(entry?.body).toMatch(/cycle/i);
  });

  it("VROL-1093 — robust-pick entry describes both directions of the CI tiebreak", () => {
    const entry = lookupGlossary("robust-pick");
    expect(entry?.title).toMatch(/Robust pick|CI-aware/i);
    expect(entry?.body).toMatch(/lower bound/i);
    expect(entry?.body).toMatch(/upper bound/i);
  });

  it("VROL-1094 — all 7 new keys are looked up cleanly (no typos in the registry)", () => {
    for (const key of [
      "replication",
      "confidence-interval",
      "half-width",
      "crn",
      "bessel-correction",
      "sensitivity-sweep",
      "robust-pick",
    ]) {
      expect(lookupGlossary(key), `key ${key} missing`).toBeDefined();
    }
  });
});
