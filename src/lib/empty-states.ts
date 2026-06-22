/**
 * VROL-787 — empty-state copy source of truth.
 *
 * Why
 * ---
 * `<EmptyState title="…" body="…" />` call-sites have been growing in parallel
 * across the wizard, editor, and result panels. Wording has drifted — "No
 * scenarios yet" vs. "No saved scenarios yet" vs. "No data" — and the body
 * copy frequently mentions buttons that have since been renamed. Pulling the
 * copy into a keyed lookup gives us one place to keep it accurate.
 *
 * Convention
 * ----------
 *  - Keys are kebab-case surface ids, namespaced loosely by feature area
 *    ("wizard-…", "results-…", "editor-…", "sensitivity-…").
 *  - `title` is a short sentence-case noun phrase. ≤ 5 words.
 *  - `body` is a one-line nudge toward the next action. Mention the verb the
 *    user will execute, in past or imperative form ("Click **Run simulation**
 *    to…", "Drag a station from the palette…").
 *  - `cta` is the optional verb-noun action label that lives on the button
 *    inside the empty state. Pulled from `src/lib/copy.ts` BUTTONS where the
 *    label already exists; otherwise add to BUTTONS first.
 *
 * Migration policy
 * ----------------
 * As with `copy.ts`, this ticket only establishes the SoT. Existing
 * `<EmptyState>` call-sites stay as-is for now. A follow-up will sweep the
 * surfaces in `EMPTY_STATE_IDS` and swap inline strings for `getEmptyState`
 * lookups. Adding a new empty surface means landing the entry here first.
 */

import { BUTTONS } from "./copy";

/**
 * Structured payload for one empty surface. Shape matches `<EmptyState>`'s
 * props (title required, body optional, cta optional) so consumers can spread
 * the result with minimal glue.
 */
export interface EmptyStateCopy {
  readonly title: string;
  readonly body?: string;
  readonly cta?: string;
}

/**
 * The full registry of named empty surfaces in the app. Add new ids here as
 * surfaces are introduced; the typed `EmptyStateId` derives from this map.
 */
export const EMPTY_STATES: Readonly<Record<string, EmptyStateCopy>> = {
  // Wizard ---------------------------------------------------------------
  "wizard-step-stations": {
    title: "No stations yet",
    body: "Add at least one station — the wizard needs something to time before it can simulate.",
    cta: BUTTONS.ADD_STATION,
  },
  "wizard-step-arrivals": {
    title: "Arrivals not set",
    body: "Pick an arrival pattern so the simulator knows how often new work enters the line.",
  },
  "wizard-step-review": {
    title: "Nothing to review",
    body: "Finish the previous steps and we'll summarize the scenario here before you run it.",
  },

  // Run / results --------------------------------------------------------
  "results-no-run": {
    title: "No results yet",
    body: "Set your horizon, warmup, and station cycle times, then press Run simulation.",
    cta: BUTTONS.RUN,
  },
  "results-no-data": {
    title: "No data to show",
    body: "The run finished without producing the metric needed for this chart.",
  },

  // Editor ---------------------------------------------------------------
  "editor-no-saved-scenarios": {
    title: "No saved scenarios yet",
    body: "Click Save current to capture the graph and run settings under a name.",
    cta: BUTTONS.SAVE_CURRENT,
  },
  "editor-no-history": {
    title: "No history yet",
    body: "Your past runs of this scenario will appear here once you simulate at least once.",
    cta: BUTTONS.RUN,
  },
  "editor-canvas-empty": {
    title: "Canvas is empty",
    body: "Drag a station from the palette, or load a preset from the scenarios panel.",
  },

  // Sensitivity / optimization ------------------------------------------
  "sensitivity-no-run": {
    title: "No sensitivity sweep yet",
    body: "Run a sensitivity sweep to see how throughput reacts as you vary cycle times.",
  },
  "sensitivity-no-stations": {
    title: "Nothing to sweep",
    body: "Add at least one timed station — sensitivity needs a variable to perturb.",
  },
  "optimization-no-run": {
    title: "No optimization yet",
    body: "Run the optimizer to find a buffer-and-cycle-time mix that improves throughput.",
  },

  // Comparison / templates ----------------------------------------------
  "comparison-no-pair": {
    title: "No comparisons yet",
    body: "Pick a saved scenario from the scenarios panel to compare it against the current canvas.",
    cta: BUTTONS.COMPARE,
  },
  "templates-none": {
    title: "No templates available",
    body: "Built-in templates will appear here as we add them. In the meantime, build from scratch in the editor.",
  },
  // VROL-804 — search-yielded-zero variants for surfaces with a filter.
  "templates-filter-empty": {
    title: "No templates match",
    body: "Nothing matches the current filter. Try a shorter query, or clear the filter to see every template.",
    cta: BUTTONS.CLEAR,
  },
  "learn-search-empty": {
    title: "No matches",
    body: "Nothing in the glossary matches your search. Try a shorter or different query.",
    cta: BUTTONS.CLEAR,
  },

  // Learn / help --------------------------------------------------------
  "learn-concepts-coming-soon": {
    title: "Concepts coming soon",
    body: "Worked walkthroughs of bottlenecks, Little's Law, and buffer sizing will land in v1.1.",
  },
  "learn-examples-coming-soon": {
    title: "Examples coming soon",
    body: "Step-by-step worked examples — load a preset, run, interpret — will land in v1.1.",
  },
} as const;

/** Surface id type, derived so consumers get autocompletion + a typo guard. */
export type EmptyStateId = keyof typeof EMPTY_STATES;

/**
 * VROL-804 — Canonical CTA tree shape.
 *
 * Every `<EmptyState>` action region matches this shape:
 *  - `primary` (required when any CTA is offered) — the most useful next
 *    action; rendered as a solid `Button`.
 *  - `secondary` (optional) — a complementary action rendered as an outline
 *    `Button`. Use when the user might reasonably want either; e.g. "Clear
 *    filter" vs. "Browse all".
 *  - `tertiary` (optional) — a low-emphasis link, typically routing
 *    elsewhere ("See docs", "Back to glossary").
 *
 * No empty state ships with more than these three. The shape is exported so
 * future call-sites can type their CTA bundle and a future lint can flag
 * overflowing surfaces.
 */
export interface EmptyStateCtaTree {
  readonly primary?: { readonly label: string; readonly onSelect: () => void };
  readonly secondary?: { readonly label: string; readonly onSelect: () => void };
  readonly tertiary?: { readonly label: string; readonly href: string };
}

/** Compile-time guard — every CTA bundle obeys the ≤ 3-action tree. */
export function assertCtaTree(tree: EmptyStateCtaTree): EmptyStateCtaTree {
  let count = 0;
  if (tree.primary) count += 1;
  if (tree.secondary) count += 1;
  if (tree.tertiary) count += 1;
  if (count > 3) {
    throw new Error("EmptyState CTA tree exceeds 3 actions (primary + secondary + tertiary).");
  }
  return tree;
}

/**
 * Lookup helper. Returns the copy bundle for the given surface id; throws at
 * runtime if the id is unknown (intentional — fail loud so missing surfaces
 * surface during dev, not silently in production).
 */
export function getEmptyState(id: EmptyStateId): EmptyStateCopy {
  const copy = EMPTY_STATES[id];
  if (!copy) {
    throw new Error(`Unknown empty-state id: ${String(id)}`);
  }
  return copy;
}

/**
 * Convenience array of every registered surface id. Useful for snapshot
 * tests, design-token pages, and future tooling that wants to lint
 * unreferenced surfaces.
 */
export const EMPTY_STATE_IDS: readonly EmptyStateId[] = Object.keys(EMPTY_STATES) as readonly [
  EmptyStateId,
  ...EmptyStateId[],
];
