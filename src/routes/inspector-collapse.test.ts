/**
 * VROL-788 — single-collapse-paradigm guard for the Inspector body.
 *
 * EditorPage's Inspector used to mix raw `<details>` HTML disclosure with
 * a hand-rolled button + conditional render for the "Advanced" section.
 * The story replaces both with shadcn `<Accordion>`. To keep a future
 * refactor from regressing the mix, this test reads the source and asserts
 * the Inspector body now consistently goes through Accordion.
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

describe("Inspector body collapse paradigm (VROL-788)", () => {
  const src = readFileSync(EDITOR_PAGE_PATH, "utf8");
  const body = inspectorBody(src);

  it("contains no <details> JSX in the inspector body", () => {
    // Match actual JSX tags, not the prose like 'was <details>'. The
    // distinguishing marker is the className= attribute that follows the
    // real element on every existing use site in this file.
    expect(body).not.toMatch(/<details\s+className=/);
    expect(body).not.toMatch(/<summary\s+className=/);
  });

  it("uses the shadcn Accordion for Cost & revenue", () => {
    expect(body).toMatch(/title="Cost & revenue \(optional\)"/);
  });

  it("uses the shadcn Accordion for the Advanced section", () => {
    expect(body).toMatch(/title="Advanced"/);
  });

  it("does not re-introduce the hand-rolled Show/Hide advanced toggle", () => {
    expect(body).not.toMatch(/Show.{0,5}advanced/);
    expect(body).not.toMatch(/Hide.{0,5}advanced/);
  });
});
