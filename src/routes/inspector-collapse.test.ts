/**
 * VROL-788 — single-collapse-paradigm guard for the Inspector body.
 *
 * Originally guarded that the Inspector body consistently used shadcn
 * `<Accordion>` for the Cost & revenue + Advanced disclosures (no raw
 * `<details>` / hand-rolled toggles).
 *
 * VROL-773 — the Inspector is now tabbed (Basics / Schedule / Recipe & cost)
 * and the Accordion disclosures have been replaced by tab panels. The
 * remaining invariants worth pinning:
 *   - no raw `<details>` JSX (the original paradigm regression we cared about);
 *   - no hand-rolled "Show advanced" toggle (it stays gone);
 *   - the three tab panels render so we don't accidentally collapse them
 *     back into a single scroll under refactor.
 *
 * Scoped strictly to the Inspector body: the Scenarios drawer still uses
 * `<details>` for the per-scenario history panel, and that's intentional.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_PAGE_PATH = join(__dirname, "EditorPage.tsx");

function inspectorBody(src: string): string {
  // The Inspector body sits between the "<CardTitle ...>Inspector" line and
  // the closing of its Card. Pick a generous window: from "Inspector" to the
  // first "Comparison" header (which begins the comparison Sheet block).
  const start = src.indexOf(">Inspector<");
  const end = src.indexOf("<SheetTitle>Comparison</SheetTitle>");
  if (start < 0 || end < 0) {
    throw new Error("Couldn't locate Inspector body — EditorPage layout changed.");
  }
  return src.slice(start, end);
}

describe("Inspector body collapse paradigm (VROL-788 / VROL-773)", () => {
  const src = readFileSync(EDITOR_PAGE_PATH, "utf8");
  const body = inspectorBody(src);

  it("contains no <details> JSX in the inspector body", () => {
    // Match actual JSX tags, not the prose like 'was <details>'. The
    // distinguishing marker is the className= attribute that follows the
    // real element on every existing use site in this file.
    expect(body).not.toMatch(/<details\s+className=/);
    expect(body).not.toMatch(/<summary\s+className=/);
  });

  it("does not re-introduce the hand-rolled Show/Hide advanced toggle", () => {
    expect(body).not.toMatch(/Show.{0,5}advanced/);
    expect(body).not.toMatch(/Hide.{0,5}advanced/);
  });

  it("renders the three VROL-773 tab panels", () => {
    expect(body).toMatch(/<TabsContent value="basics">/);
    expect(body).toMatch(/<TabsContent value="schedule">/);
    expect(body).toMatch(/<TabsContent value="recipe-cost">/);
  });
});
