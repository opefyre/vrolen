/**
 * VROL-673 — keyboard shortcuts overlay. Press "?" to open. Lists every
 * shortcut the editor responds to so users can discover them without
 * having to read source. Closes on Escape or clicking outside.
 *
 * VROL-811 — every action-shortcut row is now DERIVED from the central
 * editor action registry (`@/lib/editor-actions`). Gesture-only rows
 * (mouse drag, single-letter insert keys) stay hand-rolled below because
 * they aren't actions — they're raw input the editor responds to.
 */

import { useEffect, useMemo, useState } from "react";

import { adaptToShortcutsOverlay } from "@/lib/editor-actions-adapter";
import { defineActions, type EditorActionHandlers } from "@/lib/editor-actions";

interface Shortcut {
  readonly keys: string;
  readonly action: string;
}

interface ShortcutGroupView {
  readonly group: string;
  readonly items: readonly Shortcut[];
}

/**
 * Gesture + input rows that don't map to a registry action. Kept here
 * because they document raw browser input the editor reads, not named
 * actions you could fire from a menu.
 */
const GESTURE_GROUPS: readonly ShortcutGroupView[] = [
  {
    group: "Canvas navigation",
    items: [
      { keys: "Drag (left)", action: "Marquee-select" },
      { keys: "Space + Drag", action: "Pan the canvas" },
      { keys: "Right / middle drag", action: "Pan the canvas" },
      { keys: "Scroll", action: "Zoom in / out" },
      { keys: "Shift (drag)", action: "Lock node to nearest axis" },
    ],
  },
  {
    group: "Connections",
    items: [
      { keys: "Drag handle → empty canvas", action: "Spawn a new connected station" },
      { keys: "Drag edge endpoint", action: "Retarget connection (drop on empty to delete)" },
      { keys: "Hover edge", action: "Reveal mid-edge × delete button" },
    ],
  },
  // VROL-784 — single-letter station insertion. Mirrors the entries in
  // src/lib/shortcuts.ts; keep them in sync. The actual key dispatch lives
  // in EditorCanvas (src/routes/EditorPage.tsx).
  {
    group: "Insert station",
    items: [
      { keys: "M", action: "Insert machine at cursor" },
      { keys: "N", action: "Insert manual station at cursor" },
      { keys: "B", action: "Insert buffer at cursor" },
      { keys: "Q", action: "Insert QC station at cursor" },
      { keys: "A", action: "Insert assembly at cursor" },
      { keys: "T", action: "Insert transport at cursor" },
      { keys: "I", action: "Insert material input at cursor" },
      { keys: "O", action: "Insert output at cursor" },
      { keys: "P", action: "Insert packaging at cursor" },
      { keys: "C", action: "Insert custom station at cursor" },
      { keys: "S", action: "Insert sticky note at cursor" },
      { keys: "F", action: "Insert section frame at cursor" },
    ],
  },
  {
    group: "Mouse",
    items: [
      { keys: "Click", action: "Select a station" },
      { keys: "⌘ / Ctrl + Click", action: "Multi-select" },
      { keys: "Right-click", action: "Open context menu" },
      { keys: "⌘C / Ctrl+C", action: "Copy selection" },
      { keys: "⌘V / Ctrl+V", action: "Paste from clipboard" },
      { keys: "?", action: "Open / close this panel" },
      { keys: "Esc", action: "Close panels / sheets / palette" },
    ],
  },
];

/**
 * Noop handlers — the overlay never RUNS actions, it only reads their
 * shape (id, label, shortcut). Using a noop set lets us reuse the same
 * `defineActions` factory the editor uses, so the overlay can never drift
 * out of sync with what the editor actually supports.
 */
function noopHandlers(): EditorActionHandlers {
  const noop = (): void => undefined;
  return {
    run: noop,
    stop: noop,
    newSeed: noop,
    undo: noop,
    redo: noop,
    save: noop,
    saveAs: noop,
    saveAndExit: noop,
    duplicate: noop,
    deleteSelection: noop,
    selectAll: noop,
    deselect: noop,
    autoLayout: noop,
    fitView: noop,
    zoomIn: noop,
    zoomOut: noop,
    toggleLock: noop,
    openScenarios: noop,
    openRunSettings: noop,
    openWizard: noop,
    togglePalette: noop,
    resetCanvas: noop,
  };
}

export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);
  // Derive action-shortcut rows from the registry — the editor's single
  // source of truth for action labels + their bound keys.
  const groups = useMemo<readonly ShortcutGroupView[]>(() => {
    const actions = defineActions(noopHandlers());
    const registry = adaptToShortcutsOverlay(actions).map<ShortcutGroupView>((g) => ({
      group: g.group,
      items: g.items.map((i) => ({ keys: i.keys, action: i.action })),
    }));
    return [...registry, ...GESTURE_GROUPS];
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Don't trigger when typing in inputs.
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  if (!open) return null;
  return (
    <div
      data-testid="keyboard-shortcuts-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <button
        type="button"
        aria-label="Close shortcuts overlay"
        className="absolute inset-0 h-full w-full cursor-default bg-transparent"
        onClick={() => {
          setOpen(false);
        }}
      />
      <div className="border-border bg-card relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-lg border p-5 shadow-xl">
        <div className="font-heading mb-3 text-base font-semibold">Keyboard shortcuts</div>
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="text-muted-foreground mb-1.5 text-[10px] font-medium tracking-wide uppercase">
                {g.group}
              </div>
              <dl className="space-y-1 text-sm">
                {g.items.map((s) => (
                  <div key={s.keys} className="flex items-baseline justify-between gap-3">
                    <dt className="bg-muted shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px]">
                      {s.keys}
                    </dt>
                    <dd className="text-foreground/80 flex-1 text-right">{s.action}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
        <div className="text-muted-foreground mt-4 text-[10px]">Press Esc to close.</div>
      </div>
    </div>
  );
}
