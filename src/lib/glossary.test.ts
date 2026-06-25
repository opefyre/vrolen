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
});
