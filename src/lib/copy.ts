/**
 * VROL-790 — sentence-case copy source of truth.
 *
 * Why this exists
 * ---------------
 * Vrolen's UI has slowly grown ~150+ inline strings across buttons, empty
 * states, and toasts. Capitalisation, voice, and verb choice have drifted as
 * a result — some buttons say "Run simulation", others "Run", others "Start
 * sim". This module collapses the common labels into one place so future
 * surfaces can import a verb-noun string instead of inventing one.
 *
 * Convention (enforced by review, not by code)
 * --------------------------------------------
 *  - **Sentence case**, not Title Case. "Run simulation", never "Run Simulation".
 *  - **Verb-noun** for action labels. Buttons say what the click does, not what
 *    the page is about. "Save scenario", not "Scenario save".
 *  - **Active voice, present tense.** "Saving…" for in-flight states, "Saved"
 *    for terminal states. No "Save your scenario now!" — drop the marketing.
 *  - **No trailing punctuation** on labels. Toasts may use a period when the
 *    string is a full sentence.
 *  - **No emoji** in shipped copy. We're a Tailwind + shadcn app; icons live
 *    next to the label as JSX, not inside the string.
 *  - Keys are SCREAMING_SNAKE_CASE on the surface object, lowercase strings on
 *    the value side. The surface object name is the noun ("BUTTONS"); the key
 *    is the verb-keyed action ("RUN", "SAVE_SCENARIO").
 *
 * Migration policy
 * ----------------
 * This file is the SoT. Existing call-sites are NOT being refactored in this
 * ticket (VROL-790) — that's deliberate. Subsequent tickets (filed under the
 * "copy consistency" epic) will swap inline strings for these constants one
 * surface at a time, verifying screenshots survive each pass. Until then,
 * adding a new label means **adding it here first**, then importing it at the
 * call-site.
 *
 * Adding a new label
 * ------------------
 * 1. Pick the surface (BUTTONS / EMPTY_STATES / TOASTS / LABELS / PLACEHOLDERS).
 * 2. Add the key (verb-noun, SCREAMING_SNAKE_CASE).
 * 3. Add the value as a sentence-case string obeying the rules above.
 * 4. If unsure where it belongs, file it under LABELS and the next refactor
 *    pass will reshuffle it.
 */

/**
 * Action labels — primarily on buttons, menu items, command-palette entries.
 * Verb-noun pairs that describe what the click does.
 */
export const BUTTONS = {
  RUN: "Run simulation",
  RUN_DEMO: "Run demo",
  RUNNING: "Running…",
  STOP: "Stop simulation",
  RESET: "Reset to defaults",
  RESET_CANVAS: "Reset canvas",
  SAVE: "Save",
  SAVE_SCENARIO: "Save scenario",
  SAVE_AS: "Save as…",
  SAVE_CURRENT: "Save current",
  OPEN: "Open",
  OPEN_SCENARIO: "Open scenario",
  CLOSE: "Close",
  CANCEL: "Cancel",
  CONFIRM: "Confirm",
  APPLY: "Apply",
  APPLY_AND_RUN: "Apply and run",
  DELETE: "Delete",
  DUPLICATE: "Duplicate",
  RENAME: "Rename",
  EXPORT: "Export",
  EXPORT_CSV: "Export CSV",
  EXPORT_RUN: "Export run",
  IMPORT: "Import",
  COPY: "Copy",
  PASTE: "Paste",
  UNDO: "Undo",
  REDO: "Redo",
  NEW_SCENARIO: "New scenario",
  ADD_STATION: "Add station",
  CONTINUE: "Continue",
  BACK: "Back",
  NEXT: "Next",
  FINISH: "Finish",
  GET_STARTED: "Get started",
  LEARN_MORE: "Learn more",
  EDIT: "Edit",
  COMPARE: "Compare",
  CLEAR: "Clear",
  CLEAR_CANVAS: "Clear canvas",
  AUTO_LAYOUT: "Auto-layout",
  FIT_VIEW: "Fit view",
  ZOOM_IN: "Zoom in",
  ZOOM_OUT: "Zoom out",
} as const satisfies Record<string, string>;

/**
 * Empty-state copy. Title is the headline; body is the one-line nudge toward
 * the next action. See `src/lib/empty-states.ts` for the structured lookup
 * used by `<EmptyState>` consumers — this object is intentionally flat so
 * smaller surfaces (e.g., a chart placeholder) can grab a single label without
 * pulling the title/body/cta triple.
 */
export const EMPTY_STATES = {
  NO_RESULTS: "No results yet",
  NO_SCENARIOS: "No scenarios yet",
  NO_SAVED_SCENARIOS: "No saved scenarios yet",
  NO_RUNS: "No runs yet",
  NO_HISTORY: "No history yet",
  NO_COMPARISONS: "No comparisons yet",
  NO_STATIONS: "No stations on the canvas",
  NO_SENSITIVITY: "No sensitivity sweep yet",
  NO_RECOMMENDATIONS: "No recommendations yet",
  NO_DATA: "No data to show",
} as const satisfies Record<string, string>;

/**
 * Toast strings. Headlines only — descriptions stay at the call-site because
 * they're usually data-bound ("Saved \"Bottling line v2\""). Phrasing rule:
 * past tense for success ("Saved", "Copied"), imperative or noun-phrase for
 * errors ("Save failed", "Can't run"), present tense for info ("Reset to
 * defaults").
 */
export const TOASTS = {
  SAVED: "Saved",
  SAVE_FAILED: "Save failed",
  COPIED: "Copied",
  PASTED: "Pasted",
  DUPLICATED: "Duplicated",
  DELETED: "Deleted",
  EXPORTED: "Exported",
  EXPORT_FAILED: "Export failed",
  IMPORTED: "Imported",
  IMPORT_FAILED: "Import failed",
  SIMULATION_COMPLETE: "Simulation complete",
  SIMULATION_FAILED: "Simulation failed",
  CANT_RUN: "Can't run",
  CANT_SAVE: "Can't save",
  RESET_TO_DEFAULTS: "Reset to defaults",
  CANVAS_CLEARED: "Canvas cleared",
  CANVAS_EMPTY: "Canvas is empty",
  AUTO_LAYOUT_APPLIED: "Auto-layout applied",
  EDITOR_RESET: "Editor reset",
  COMING_SOON: "Coming soon",
  OFFLINE: "You're offline",
  BACK_ONLINE: "Back online",
} as const satisfies Record<string, string>;

/**
 * Free-floating labels — section headings, KPI captions, table column
 * headers, badge text. Anything sentence-case-ish that isn't a button label
 * or empty-state title goes here. Refactor pass will reshuffle into more
 * specific surfaces if a pattern emerges.
 */
export const LABELS = {
  THROUGHPUT: "Throughput",
  UTILIZATION: "Utilization",
  WIP: "Work-in-progress",
  CYCLE_TIME: "Cycle time",
  HORIZON: "Horizon",
  WARMUP: "Warmup",
  STATIONS: "Stations",
  BUFFERS: "Buffers",
  REPLICATIONS: "Replications",
  SENSITIVITY: "Sensitivity",
  RECOMMENDATIONS: "Recommendations",
  COMPARISON: "Comparison",
  HISTORY: "History",
  SETTINGS: "Settings",
  PREVIEW: "Preview",
  RESULTS: "Results",
  KPIS: "KPIs",
} as const satisfies Record<string, string>;

/**
 * Input placeholders. Sentence case, no trailing period, no "Enter…" prefix
 * (just describe the field, e.g. "Scenario name", not "Enter scenario name").
 */
export const PLACEHOLDERS = {
  SCENARIO_NAME: "Scenario name",
  STATION_NAME: "Station name",
  SEARCH: "Search…",
  FILTER: "Filter…",
} as const satisfies Record<string, string>;

/**
 * Type-safe surface keys, useful when threading copy through a generic
 * helper (e.g., a future `<Toast variant={key}/>`).
 */
export type ButtonKey = keyof typeof BUTTONS;
export type EmptyStateKey = keyof typeof EMPTY_STATES;
export type ToastKey = keyof typeof TOASTS;
export type LabelKey = keyof typeof LABELS;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;
