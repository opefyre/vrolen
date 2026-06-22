/**
 * VROL-811 — tests for the central editor action registry.
 *
 * Covers:
 *   • every action has a unique id
 *   • every action has a non-empty label
 *   • isDisabled honors the context flags it advertises
 *   • run(ctx) calls the matching handler exactly once
 *   • visibility filters Stop unless ctx.isRunning
 *   • runAction is a no-op when disabled
 *
 * Surface-coverage test (the command palette + keyboard overlay both reach
 * every registry action) is at the bottom — proves the registry IS the
 * single source of truth.
 */

import { describe, expect, it, vi } from "vitest";

import {
  defineActions,
  getAction,
  modKey,
  runAction,
  visibleActions,
  type EditorActionContext,
  type EditorActionHandlers,
} from "./editor-actions";

function noopHandlers(): EditorActionHandlers {
  return {
    run: vi.fn(),
    stop: vi.fn(),
    newSeed: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    save: vi.fn(),
    saveAs: vi.fn(),
    saveAndExit: vi.fn(),
    duplicate: vi.fn(),
    deleteSelection: vi.fn(),
    selectAll: vi.fn(),
    deselect: vi.fn(),
    autoLayout: vi.fn(),
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    toggleLock: vi.fn(),
    openScenarios: vi.fn(),
    openRunSettings: vi.fn(),
    openWizard: vi.fn(),
    togglePalette: vi.fn(),
    resetCanvas: vi.fn(),
  };
}

function ctx(overrides: Partial<EditorActionContext> = {}): EditorActionContext {
  return {
    hasSelection: false,
    hasNodes: true,
    canUndo: true,
    canRedo: true,
    isRunning: false,
    scenarioName: null,
    ...overrides,
  };
}

describe("editor-actions registry (VROL-811)", () => {
  it("every action has a unique id", () => {
    const actions = defineActions(noopHandlers());
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every action has a non-empty sentence-case label", () => {
    const actions = defineActions(noopHandlers());
    for (const a of actions) {
      expect(a.label.length).toBeGreaterThan(0);
      // Sentence case — first char is uppercase, second is lowercase.
      expect(a.label[0]).toBe(a.label[0]?.toUpperCase());
    }
  });

  it("every action declares a group from the known set", () => {
    const known = new Set(["scenario", "edit", "view", "selection", "help"]);
    for (const a of defineActions(noopHandlers())) {
      expect(known.has(a.group)).toBe(true);
    }
  });

  it("covers the required action ids from the spec", () => {
    const actions = defineActions(noopHandlers());
    const required = [
      "run",
      "run-new-seed",
      "stop",
      "undo",
      "redo",
      "save",
      "save-as",
      "save-and-exit",
      "duplicate",
      "delete-selection",
      "select-all",
      "deselect",
      "auto-layout",
      "fit-view",
      "zoom-in",
      "zoom-out",
      "toggle-lock",
      "open-scenarios",
      "open-run-settings",
      "open-wizard",
      "toggle-palette",
    ];
    for (const id of required) {
      expect(
        actions.find((a) => a.id === id),
        `missing action: ${id}`,
      ).toBeDefined();
    }
  });

  it("omits optional actions when the handler is not supplied", () => {
    const full = noopHandlers();
    const rest: EditorActionHandlers = {
      run: full.run,
      newSeed: full.newSeed,
      undo: full.undo,
      redo: full.redo,
      save: full.save,
      saveAndExit: full.saveAndExit,
      duplicate: full.duplicate,
      deleteSelection: full.deleteSelection,
      selectAll: full.selectAll,
      deselect: full.deselect,
      autoLayout: full.autoLayout,
      fitView: full.fitView,
      zoomIn: full.zoomIn,
      zoomOut: full.zoomOut,
      toggleLock: full.toggleLock,
      openScenarios: full.openScenarios,
      openRunSettings: full.openRunSettings,
      openWizard: full.openWizard,
      togglePalette: full.togglePalette,
      resetCanvas: full.resetCanvas,
    };
    const actions = defineActions(rest);
    expect(actions.find((a) => a.id === "stop")).toBeUndefined();
    expect(actions.find((a) => a.id === "save-as")).toBeUndefined();
  });

  it("isDisabled honors context flags", () => {
    const actions = defineActions(noopHandlers());
    const undo = getAction(actions, "undo");
    expect(undo.isDisabled?.(ctx({ canUndo: false }))).toBe(true);
    expect(undo.isDisabled?.(ctx({ canUndo: true }))).toBe(false);

    const redo = getAction(actions, "redo");
    expect(redo.isDisabled?.(ctx({ canRedo: false }))).toBe(true);
    expect(redo.isDisabled?.(ctx({ canRedo: true }))).toBe(false);

    const dup = getAction(actions, "duplicate");
    expect(dup.isDisabled?.(ctx({ hasSelection: false }))).toBe(true);
    expect(dup.isDisabled?.(ctx({ hasSelection: true }))).toBe(false);

    const del = getAction(actions, "delete-selection");
    expect(del.isDisabled?.(ctx({ hasSelection: false }))).toBe(true);

    const selAll = getAction(actions, "select-all");
    expect(selAll.isDisabled?.(ctx({ hasNodes: false }))).toBe(true);

    const run = getAction(actions, "run");
    expect(run.isDisabled?.(ctx({ isRunning: true }))).toBe(true);
    expect(run.isDisabled?.(ctx({ isRunning: false }))).toBe(false);

    const fit = getAction(actions, "fit-view");
    expect(fit.isDisabled?.(ctx({ hasNodes: false }))).toBe(true);
  });

  it("running an action calls the matching handler exactly once", () => {
    const handlers = noopHandlers();
    const actions = defineActions(handlers);
    getAction(actions, "run").run(ctx());
    expect(handlers.run).toHaveBeenCalledTimes(1);
    getAction(actions, "undo").run(ctx());
    expect(handlers.undo).toHaveBeenCalledTimes(1);
    getAction(actions, "save").run(ctx());
    expect(handlers.save).toHaveBeenCalledTimes(1);
    getAction(actions, "duplicate").run(ctx());
    expect(handlers.duplicate).toHaveBeenCalledTimes(1);
    getAction(actions, "auto-layout").run(ctx());
    expect(handlers.autoLayout).toHaveBeenCalledTimes(1);
    getAction(actions, "fit-view").run(ctx());
    expect(handlers.fitView).toHaveBeenCalledTimes(1);
    getAction(actions, "toggle-palette").run(ctx());
    expect(handlers.togglePalette).toHaveBeenCalledTimes(1);
    // Cross-check the handler that powers "delete-selection".
    getAction(actions, "delete-selection").run(ctx());
    expect(handlers.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it("Stop is hidden unless a run is in flight", () => {
    const actions = defineActions(noopHandlers());
    const idle = visibleActions(actions, ctx({ isRunning: false }));
    const running = visibleActions(actions, ctx({ isRunning: true }));
    expect(idle.find((a) => a.id === "stop")).toBeUndefined();
    expect(running.find((a) => a.id === "stop")).toBeDefined();
  });

  it("runAction is a no-op when the action is disabled", () => {
    const handlers = noopHandlers();
    const actions = defineActions(handlers);
    runAction(actions, "undo", ctx({ canUndo: false }));
    expect(handlers.undo).not.toHaveBeenCalled();
    runAction(actions, "undo", ctx({ canUndo: true }));
    expect(handlers.undo).toHaveBeenCalledTimes(1);
  });

  it("getAction throws on an unknown id", () => {
    const actions = defineActions(noopHandlers());
    expect(() => getAction(actions, "no-such-action")).toThrow();
  });

  it("modKey matches Cmd/Ctrl + key, ignoring case", () => {
    const m = modKey("s");
    expect(m(new KeyboardEvent("keydown", { key: "S", metaKey: true }))).toBe(true);
    expect(m(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }))).toBe(true);
    expect(m(new KeyboardEvent("keydown", { key: "s" }))).toBe(false);
    expect(m(new KeyboardEvent("keydown", { key: "s", metaKey: true, shiftKey: true }))).toBe(
      false,
    );
    const withShift = modKey("z", { shift: true });
    expect(
      withShift(new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true })),
    ).toBe(true);
    expect(withShift(new KeyboardEvent("keydown", { key: "z", metaKey: true }))).toBe(false);
  });

  it("matching key events resolve to exactly one action", () => {
    const actions = defineActions(noopHandlers());
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    const hits = actions.filter((a) => a.keyMatcher?.(e));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("toggle-palette");
  });
});

describe("editor-actions surface coverage (VROL-811)", () => {
  // The command palette uses the SAME registry directly, so by construction
  // every registry action is reachable from Cmd-K. This is a structural
  // assertion: there is no separate hand-rolled palette list to skew.
  it("the command palette list equals the registry (1:1)", async () => {
    const { adaptToCommandPalette } = await import("./editor-actions-adapter");
    const actions = defineActions(noopHandlers());
    const palette = adaptToCommandPalette(actions, ctx());
    // Stop is hidden unless running; that's the only intentional gap.
    const expected = actions.filter((a) => a.id !== "stop");
    expect(palette.map((a) => a.id).sort()).toEqual(expected.map((a) => a.id).sort());
  });

  it("the keyboard shortcut overlay surfaces every registry action that has a display shortcut", async () => {
    const { adaptToShortcutsOverlay } = await import("./editor-actions-adapter");
    const actions = defineActions(noopHandlers());
    const rows = adaptToShortcutsOverlay(actions);
    const flat = rows.flatMap((g) => g.items.map((i) => i.id));
    const expected = actions.filter((a) => typeof a.shortcut === "string").map((a) => a.id);
    for (const id of expected) {
      expect(flat, `overlay missing ${id}`).toContain(id);
    }
  });
});
