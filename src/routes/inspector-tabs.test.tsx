/**
 * VROL-773 — tabbed Inspector (Basics / Schedule / Recipe & cost).
 *
 * EditorPage's Inspector body depends on a fully-mounted EditorPage tree
 * (react-flow store, Supabase scenarios listener, run worker, …), so a true
 * end-to-end render is out of scope for a unit test. Instead this file
 * exercises the contract three ways:
 *
 *   1. Behaviour — a minimal harness that mirrors EditorPage's tab pattern
 *      (state + sessionStorage hook + Tabs primitive + keydown wiring).
 *      The harness is intentionally tiny so the tests don't drift from
 *      EditorPage's actual layout; the structural tests below guard the
 *      "same wiring" invariant.
 *   2. Structural — read EditorPage.tsx as source and assert the tab strip,
 *      sessionStorage key, and per-tab error-dot logic live there.
 *   3. Source-level sanity — the anchor strip from VROL-669 is gone and the
 *      old per-section ids are not re-introduced.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FieldErrorIndicator } from "@/components/editor/field-error-indicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ValidationIssue } from "@/lib/validate-scenario";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EDITOR_PAGE_PATH = join(__dirname, "EditorPage.tsx");

// ─── Mirrors EditorPage's storage key + tab order. If EditorPage diverges
// from these, the structural tests below fail loudly. ───────────────────────
const STORAGE_KEY = "vrolen:inspector-tab";
type TabKey = "basics" | "schedule" | "recipe-cost";
const TAB_ORDER: readonly TabKey[] = ["basics", "schedule", "recipe-cost"];

interface HarnessProps {
  readonly issues?: readonly ValidationIssue[];
}

function InspectorTabsHarness({ issues = [] }: HarnessProps) {
  const [tab, setTab] = useState<TabKey>(() => {
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored === "basics" || stored === "schedule" || stored === "recipe-cost") {
        return stored;
      }
    } catch {
      // happy-dom always provides sessionStorage; this guards the SSR path.
    }
    return "basics";
  });
  useEffect(() => {
    window.sessionStorage.setItem(STORAGE_KEY, tab);
  }, [tab]);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        if (v === "basics" || v === "schedule" || v === "recipe-cost") setTab(v);
      }}
    >
      <TabsList>
        {TAB_ORDER.map((t) => {
          const tabIssues = issues.filter((i) => i.path?.endsWith(`.${tabFieldFor(t)}`));
          return (
            <TabsTrigger
              key={t}
              value={t}
              data-testid={`tab-${t}`}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const idx = TAB_ORDER.indexOf(tab);
                if (idx === -1) return;
                const delta = e.key === "ArrowRight" ? 1 : -1;
                const next = TAB_ORDER[(idx + delta + TAB_ORDER.length) % TAB_ORDER.length];
                if (next) setTab(next);
              }}
            >
              <span>{t}</span>
              {tabIssues.length > 0 ? <FieldErrorIndicator issues={tabIssues} /> : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
      <TabsContent value="basics">
        <div data-testid="panel-basics">Basics panel</div>
      </TabsContent>
      <TabsContent value="schedule">
        <div data-testid="panel-schedule">Schedule panel</div>
      </TabsContent>
      <TabsContent value="recipe-cost">
        <div data-testid="panel-recipe-cost">Recipe & cost panel</div>
      </TabsContent>
    </Tabs>
  );
}

function tabFieldFor(tab: TabKey): string {
  // The first field in each tab's allowlist; matches EditorPage.tsx's
  // INSPECTOR_TAB_FIELDS — keep in sync if that map changes.
  if (tab === "basics") return "defectRate";
  if (tab === "schedule") return "skills";
  return "costPerHour";
}

function issue(opts: {
  readonly nodeId: string;
  readonly field: string;
  readonly severity?: ValidationIssue["severity"];
}): ValidationIssue {
  return {
    code: "test",
    severity: opts.severity ?? "error",
    category: "schema",
    message: `boom on ${opts.field}`,
    path: `nodes[0].data.${opts.field}`,
    nodeId: opts.nodeId,
  };
}

describe("Inspector tabs harness (VROL-773 behaviour)", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("renders the active tab's panel and switches on click", () => {
    render(<InspectorTabsHarness />);
    expect(screen.getByTestId("panel-basics")).toBeTruthy();
    // Other panels are not in the accessibility tree when inactive.
    expect(screen.queryByTestId("panel-schedule")).toBeNull();

    fireEvent.click(screen.getByTestId("tab-schedule"));
    expect(screen.getByTestId("panel-schedule")).toBeTruthy();
    expect(screen.queryByTestId("panel-basics")).toBeNull();

    fireEvent.click(screen.getByTestId("tab-recipe-cost"));
    expect(screen.getByTestId("panel-recipe-cost")).toBeTruthy();
  });

  it("round-trips the active tab through sessionStorage", () => {
    const { unmount } = render(<InspectorTabsHarness />);
    fireEvent.click(screen.getByTestId("tab-schedule"));
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("schedule");
    unmount();

    // Fresh mount picks up the stored tab — flipping between stations in
    // EditorPage should preserve the user's tab choice.
    render(<InspectorTabsHarness />);
    expect(screen.getByTestId("panel-schedule")).toBeTruthy();
  });

  it("renders a validation dot on the tab whose field has an active issue", () => {
    render(
      <InspectorTabsHarness
        issues={[issue({ nodeId: "a", field: "skills", severity: "error" })]}
      />,
    );
    // The dot is the FieldErrorIndicator span inside the schedule trigger.
    const scheduleTab = screen.getByTestId("tab-schedule");
    expect(scheduleTab.querySelector("[data-testid='field-error-indicator']")).toBeTruthy();
    const basicsTab = screen.getByTestId("tab-basics");
    expect(basicsTab.querySelector("[data-testid='field-error-indicator']")).toBeNull();
  });

  it("moves between tabs with ArrowLeft / ArrowRight", () => {
    render(<InspectorTabsHarness />);
    const basics = screen.getByTestId("tab-basics");
    fireEvent.keyDown(basics, { key: "ArrowRight" });
    expect(screen.getByTestId("panel-schedule")).toBeTruthy();

    const schedule = screen.getByTestId("tab-schedule");
    fireEvent.keyDown(schedule, { key: "ArrowRight" });
    expect(screen.getByTestId("panel-recipe-cost")).toBeTruthy();

    // Wraps from right edge.
    const recipeCost = screen.getByTestId("tab-recipe-cost");
    fireEvent.keyDown(recipeCost, { key: "ArrowRight" });
    expect(screen.getByTestId("panel-basics")).toBeTruthy();

    // And from left edge.
    const basicsAgain = screen.getByTestId("tab-basics");
    fireEvent.keyDown(basicsAgain, { key: "ArrowLeft" });
    expect(screen.getByTestId("panel-recipe-cost")).toBeTruthy();
  });
});

describe("EditorPage Inspector tab wiring (VROL-773 structural)", () => {
  const src = readFileSync(EDITOR_PAGE_PATH, "utf8");

  it("declares the three tab keys and the sessionStorage key", () => {
    expect(src).toMatch(/INSPECTOR_TAB_STORAGE_KEY = "vrolen:inspector-tab"/);
    expect(src).toMatch(/"basics" \| "schedule" \| "recipe-cost"/);
    expect(src).toMatch(/INSPECTOR_TAB_ORDER: readonly InspectorTab\[\]/);
  });

  it("renders three TabsContent panels — one per tab key", () => {
    expect(src).toMatch(/<TabsContent value="basics">/);
    expect(src).toMatch(/<TabsContent value="schedule">/);
    expect(src).toMatch(/<TabsContent value="recipe-cost">/);
  });

  it("wires per-tab validation issues into INSPECTOR_TAB_FIELDS aggregation", () => {
    expect(src).toMatch(/INSPECTOR_TAB_FIELDS\["recipe-cost"\]/);
    expect(src).toMatch(/inspector-tab-dot-\$\{tab\}/);
  });

  it("hands the mobile fallback to a <select> and hides the TabsList on small viewports", () => {
    // Mobile dropdown is rendered + tied to the same tab state. The TabsList
    // is hidden under the `sm:flex` breakpoint.
    expect(src).toMatch(/data-testid="inspector-tab-select"/);
    expect(src).toMatch(/hidden h-9 w-full justify-start gap-0 rounded-none border-b px-3 sm:flex/);
  });

  it("drops the VROL-669 anchor jump strip and its anchor ids", () => {
    expect(src).not.toMatch(/#insp-general/);
    expect(src).not.toMatch(/#insp-recipe/);
    expect(src).not.toMatch(/#insp-custom/);
    expect(src).not.toMatch(/#insp-advanced/);
  });
});
