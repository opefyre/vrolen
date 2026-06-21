/**
 * VROL-786 — single shortcut source of truth.
 *
 * Why
 * ---
 * The keyboard-shortcuts overlay (`src/components/editor/keyboard-shortcuts.tsx`)
 * hand-rolls the displayed shortcut list, and the editor handler in
 * `src/routes/EditorPage.tsx` hand-rolls the actual key bindings. The two
 * have drifted at least once (VROL-732 fix). This module is the SoT both
 * sides will eventually read from — for this ticket we land the export
 * shape and the current shortcut list; refactoring the overlay and the
 * handler to consume it is deferred to follow-up tickets.
 *
 * Shape
 * -----
 * `SHORTCUTS` is grouped by surface so the overlay can render section
 * headers without inferring them. Each shortcut has both a `keys` string
 * (display label — already includes the mac/windows split with " / ") and
 * an `action` string (sentence-case verb-noun describing what the binding
 * does, matching the convention from `src/lib/copy.ts`).
 *
 * Adding a shortcut
 * -----------------
 * 1. Add the entry here under the right group.
 * 2. Wire the binding in whichever handler reacts to it.
 * 3. Verify the overlay renders the new entry (it will, once VROL-786's
 *    follow-up swaps the inline list for this export).
 */

export interface ShortcutItem {
  readonly keys: string;
  readonly action: string;
}

export interface ShortcutGroup {
  readonly group: string;
  readonly items: readonly ShortcutItem[];
}

/**
 * The canonical shortcut catalog. Mirrors the array currently inlined in
 * `keyboard-shortcuts.tsx`; do NOT diverge them — that's the whole reason
 * this file exists.
 */
export const SHORTCUTS: readonly ShortcutGroup[] = [
  {
    group: "General",
    items: [
      { keys: "⌘K / Ctrl+K", action: "Open command palette" },
      { keys: "⌘Z / Ctrl+Z", action: "Undo" },
      { keys: "⇧⌘Z / Ctrl+Shift+Z", action: "Redo" },
      { keys: "⌘↵ / Ctrl+Enter", action: "Run simulation" },
      { keys: "⌘S / Ctrl+S", action: "Save active scenario" },
      { keys: "?", action: "Open / close this panel" },
      { keys: "Esc", action: "Close panels / sheets / palette" },
    ],
  },
  {
    group: "Selection & edit",
    items: [
      { keys: "Click", action: "Select a station" },
      { keys: "⌘ / Ctrl + Click", action: "Multi-select" },
      { keys: "⌘A / Ctrl+A", action: "Select all nodes" },
      { keys: "⌘C / Ctrl+C", action: "Copy selection" },
      { keys: "⌘V / Ctrl+V", action: "Paste from clipboard" },
      { keys: "⌘D / Ctrl+D", action: "Duplicate selection" },
      { keys: "Delete / Backspace", action: "Delete selection" },
      { keys: "Right-click", action: "Open context menu" },
    ],
  },
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
] as const;

/** Flat view of every shortcut, useful for search or audit tooling. */
export const SHORTCUTS_FLAT: readonly ShortcutItem[] = SHORTCUTS.flatMap((g) => g.items);
