/**
 * VROL-811 — Central editor action registry.
 *
 * Single source of truth for every editor action (Run, Undo, Save, Duplicate,
 * Auto-layout, Fit view, Open scenarios, …). Before this file lived, each
 * surface (top toolbar, command palette, right-click menu, keyboard handler,
 * shortcut overlay) carried its OWN copy of label/icon/shortcut/disabled
 * rules/handler — five wires to cut every time an action moved or got renamed.
 *
 * The registry shape:
 *
 *   defineActions(handlers)
 *     → readonly EditorAction[]
 *
 * The host (EditorPage) owns the side effects — `handlers` is a record of
 * thin callbacks — and the registry owns the *shape* (id, label, group,
 * shortcut display, disabled rules, optional icon). Every surface derives
 * its rendered list from the registry by id:
 *
 *   const a = actions.find(a => a.id === "run");
 *   if (a && !a.isDisabled?.(ctx)) a.run(ctx);
 *
 * Adding a new action is now a 1-file change.
 */

import type { LucideIcon } from "lucide-react";

/**
 * Live editor state the registry needs to compute disabled / visibility.
 * Add a flag here when an action's enablement depends on something new —
 * never reach into module-scope state from inside a registry action.
 */
export interface EditorActionContext {
  /** At least one node is currently selected (single or multi). */
  readonly hasSelection: boolean;
  /** Canvas has any nodes — gates Select-all, Auto-layout, Fit view. */
  readonly hasNodes: boolean;
  /** Undo history non-empty. */
  readonly canUndo: boolean;
  /** Redo future non-empty. */
  readonly canRedo: boolean;
  /** A simulation run is in flight — disables Run, enables Stop. */
  readonly isRunning: boolean;
  /** Active scenario name, or null when the canvas is "Untitled scenario". */
  readonly scenarioName: string | null;
}

/**
 * The side-effect callbacks the host provides. Each maps 1:1 to an action's
 * `run`; keep them thin — validation, toast, state mutation all live in the
 * handler closure on the host side. The registry never owns business logic.
 *
 * Optional handlers (`stop`, `saveAs`, etc.) hide their action from the
 * registry output when the host doesn't supply them, so surfaces never
 * render a button that does nothing.
 */
export interface EditorActionHandlers {
  readonly run: () => void;
  readonly stop?: () => void;
  readonly newSeed: () => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly save: () => void;
  readonly saveAs?: () => void;
  readonly saveAndExit: () => void;
  readonly duplicate: () => void;
  readonly deleteSelection: () => void;
  readonly selectAll: () => void;
  readonly deselect: () => void;
  readonly autoLayout: () => void;
  readonly fitView: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly toggleLock: () => void;
  readonly openScenarios: () => void;
  readonly openRunSettings: () => void;
  readonly openWizard: () => void;
  readonly togglePalette: () => void;
  readonly resetCanvas: () => void;
}

/** Grouping for command palette + shortcut overlay sections. */
export type EditorActionGroup = "scenario" | "edit" | "view" | "selection" | "help";

export interface EditorAction {
  /** Stable identifier — never change once shipped (callers `find` by id). */
  readonly id: string;
  /** Sentence-case label. Shown in palette, toolbar tooltip, overlay. */
  readonly label: string;
  /** One-line palette hint. Optional. */
  readonly description?: string;
  /** Optional lucide icon — surfaces that don't render icons just ignore it. */
  readonly icon?: LucideIcon;
  /** Display shortcut, e.g. "⌘S". For documentation only — no dispatch. */
  readonly shortcut?: string;
  /** Optional event matcher. Lets a host wire keydown without a giant switch. */
  readonly keyMatcher?: (event: KeyboardEvent) => boolean;
  /** Logical group — drives palette section headings + overlay grouping. */
  readonly group: EditorActionGroup;
  /** Execute the action. Context lets the action read live disabled flags. */
  readonly run: (ctx: EditorActionContext) => void;
  /** Compute disabled state at render time. Defaults to "enabled". */
  readonly isDisabled?: (ctx: EditorActionContext) => boolean;
  /** Hide entirely when false. Used for Stop (only visible while running). */
  readonly isVisible?: (ctx: EditorActionContext) => boolean;
}

/** True when an action lacks a host handler and should be omitted. */
function hasHandler<K extends keyof EditorActionHandlers>(
  handlers: EditorActionHandlers,
  key: K,
): handlers is EditorActionHandlers & Record<K, NonNullable<EditorActionHandlers[K]>> {
  return typeof handlers[key] === "function";
}

/**
 * Convenience matcher for Mod+key combinations (Cmd on mac, Ctrl elsewhere).
 * Exported so callers can compose more complex matchers without re-implementing
 * the modifier convention.
 */
export function modKey(key: string, opts: { shift?: boolean } = {}): (e: KeyboardEvent) => boolean {
  const wantShift = opts.shift === true;
  const target = key.toLowerCase();
  return (e: KeyboardEvent): boolean => {
    if (!(e.metaKey || e.ctrlKey)) return false;
    if (e.altKey) return false;
    if (e.shiftKey !== wantShift) return false;
    return e.key.toLowerCase() === target;
  };
}

/**
 * Returns the full editor action list wired to `handlers`. Stable per call —
 * the host should rebuild it when its handlers change (typically every render).
 */
export function defineActions(handlers: EditorActionHandlers): readonly EditorAction[] {
  const list: EditorAction[] = [];

  // --- Scenario / Run ---
  list.push({
    id: "run",
    label: "Run simulation",
    description: "Execute the current chain",
    group: "scenario",
    shortcut: "⌘↵",
    keyMatcher: modKey("Enter"),
    isDisabled: (ctx) => ctx.isRunning,
    run: () => {
      handlers.run();
    },
  });
  list.push({
    id: "run-new-seed",
    label: "Run with new seed",
    description: "Re-roll the PRNG and re-run",
    group: "scenario",
    isDisabled: (ctx) => ctx.isRunning,
    run: () => {
      handlers.newSeed();
    },
  });
  if (hasHandler(handlers, "stop")) {
    const stop = handlers.stop;
    list.push({
      id: "stop",
      label: "Stop simulation",
      description: "Cancel the in-flight run",
      group: "scenario",
      isVisible: (ctx) => ctx.isRunning,
      run: () => {
        stop();
      },
    });
  }
  list.push({
    id: "save",
    label: "Save scenario",
    description: "Save the active scenario in place",
    group: "scenario",
    shortcut: "⌘S",
    keyMatcher: modKey("s"),
    run: () => {
      handlers.save();
    },
  });
  if (hasHandler(handlers, "saveAs")) {
    const saveAs = handlers.saveAs;
    list.push({
      id: "save-as",
      label: "Save as new scenario",
      description: "Save under a new name",
      group: "scenario",
      shortcut: "⌘⇧S",
      keyMatcher: modKey("s", { shift: true }),
      run: () => {
        saveAs();
      },
    });
  }
  list.push({
    id: "save-and-exit",
    label: "Save and exit",
    description: "Save the active scenario and leave the editor",
    group: "scenario",
    run: () => {
      handlers.saveAndExit();
    },
  });
  list.push({
    id: "open-scenarios",
    label: "Open scenarios",
    description: "Save, load, compare, manage presets",
    group: "scenario",
    run: () => {
      handlers.openScenarios();
    },
  });
  list.push({
    id: "open-run-settings",
    label: "Open run settings",
    description: "Horizon, materials, breakdowns, workers",
    group: "scenario",
    run: () => {
      handlers.openRunSettings();
    },
  });
  list.push({
    id: "open-wizard",
    label: "Open scenario wizard",
    description: "Guided build — shape → stations → arrivals → realism → review",
    group: "scenario",
    run: () => {
      handlers.openWizard();
    },
  });

  // --- Edit / History ---
  list.push({
    id: "undo",
    label: "Undo",
    group: "edit",
    shortcut: "⌘Z",
    keyMatcher: modKey("z"),
    isDisabled: (ctx) => !ctx.canUndo,
    run: () => {
      handlers.undo();
    },
  });
  list.push({
    id: "redo",
    label: "Redo",
    group: "edit",
    shortcut: "⌘⇧Z",
    keyMatcher: modKey("z", { shift: true }),
    isDisabled: (ctx) => !ctx.canRedo,
    run: () => {
      handlers.redo();
    },
  });
  list.push({
    id: "duplicate",
    label: "Duplicate selection",
    group: "edit",
    shortcut: "⌘D",
    keyMatcher: modKey("d"),
    isDisabled: (ctx) => !ctx.hasSelection,
    run: () => {
      handlers.duplicate();
    },
  });
  list.push({
    id: "delete-selection",
    label: "Delete selection",
    group: "edit",
    shortcut: "Del",
    isDisabled: (ctx) => !ctx.hasSelection,
    run: () => {
      handlers.deleteSelection();
    },
  });
  list.push({
    id: "auto-layout",
    label: "Auto-layout chain",
    description: "Arrange the graph by depth",
    group: "edit",
    isDisabled: (ctx) => !ctx.hasNodes,
    run: () => {
      handlers.autoLayout();
    },
  });
  list.push({
    id: "reset-canvas",
    label: "Reset to the default bottling line",
    group: "edit",
    run: () => {
      handlers.resetCanvas();
    },
  });
  list.push({
    id: "toggle-lock",
    label: "Toggle lock on selection",
    description: "Pin / unpin nodes from being dragged",
    group: "edit",
    isDisabled: (ctx) => !ctx.hasSelection,
    run: () => {
      handlers.toggleLock();
    },
  });

  // --- Selection ---
  list.push({
    id: "select-all",
    label: "Select all nodes",
    group: "selection",
    shortcut: "⌘A",
    keyMatcher: modKey("a"),
    isDisabled: (ctx) => !ctx.hasNodes,
    run: () => {
      handlers.selectAll();
    },
  });
  list.push({
    id: "deselect",
    label: "Deselect",
    group: "selection",
    shortcut: "Esc",
    isDisabled: (ctx) => !ctx.hasSelection,
    run: () => {
      handlers.deselect();
    },
  });

  // --- View ---
  list.push({
    id: "fit-view",
    label: "Fit canvas to view",
    group: "view",
    shortcut: "F",
    isDisabled: (ctx) => !ctx.hasNodes,
    run: () => {
      handlers.fitView();
    },
  });
  list.push({
    id: "zoom-in",
    label: "Zoom in",
    group: "view",
    run: () => {
      handlers.zoomIn();
    },
  });
  list.push({
    id: "zoom-out",
    label: "Zoom out",
    group: "view",
    run: () => {
      handlers.zoomOut();
    },
  });

  // --- Help / palette ---
  list.push({
    id: "toggle-palette",
    label: "Toggle command palette",
    description: "Open or close the Cmd-K command palette",
    group: "help",
    shortcut: "⌘K",
    keyMatcher: modKey("k"),
    run: () => {
      handlers.togglePalette();
    },
  });

  return list;
}

/**
 * Filter to the actions a surface should render — strips entries hidden by
 * `isVisible(ctx) === false`. The palette + toolbar call this, the test for
 * the registry shape walks the un-filtered list.
 */
export function visibleActions(
  actions: readonly EditorAction[],
  ctx: EditorActionContext,
): readonly EditorAction[] {
  return actions.filter((a) => (a.isVisible ? a.isVisible(ctx) : true));
}

/**
 * Resolve an action by id. Throws when missing — callers passing a stale id
 * are buggy, and we'd rather fail loud than silently no-op a toolbar button.
 */
export function getAction(actions: readonly EditorAction[], id: string): EditorAction {
  const a = actions.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown editor action id: ${id}`);
  return a;
}

/** Convenience — invoke an action by id with the current context. */
export function runAction(
  actions: readonly EditorAction[],
  id: string,
  ctx: EditorActionContext,
): void {
  const a = getAction(actions, id);
  if (a.isDisabled?.(ctx)) return;
  a.run(ctx);
}
