/**
 * Adapters that translate the central EditorAction registry into the shape
 * each surface (command palette, keyboard-shortcut overlay) renders.
 *
 * Why split this from `editor-actions.ts`: the registry is a pure data
 * structure with no UI imports. The adapters know about the palette's
 * CommandAction contract and the overlay's grouped-row layout — those
 * surface details don't belong in the registry itself.
 */

import type { CommandAction } from "@/components/canvas/command-palette";

import {
  visibleActions,
  type EditorAction,
  type EditorActionContext,
  type EditorActionGroup,
} from "./editor-actions";

const GROUP_LABEL: Record<EditorActionGroup, string> = {
  scenario: "Scenario",
  edit: "Edit",
  view: "View",
  selection: "Selection",
  help: "Help",
};

/**
 * Project the registry into the CommandAction list the local editor command
 * palette renders. Disabled state is computed from the live context so the
 * palette greys out actions the user can't currently run.
 */
export function adaptToCommandPalette(
  actions: readonly EditorAction[],
  ctx: EditorActionContext,
): readonly CommandAction[] {
  return visibleActions(actions, ctx).map<CommandAction>((a) => {
    const description = a.description;
    const shortcut = a.shortcut;
    const disabled = a.isDisabled?.(ctx) ?? false;
    return {
      id: a.id,
      label: a.label,
      ...(description !== undefined ? { hint: description } : {}),
      group: GROUP_LABEL[a.group],
      ...(shortcut !== undefined ? { shortcut } : {}),
      disabled,
      run: () => {
        if (a.isDisabled?.(ctx)) return;
        a.run(ctx);
      },
    };
  });
}

/** A single row in the keyboard-shortcut overlay, paired back to its action id. */
export interface ShortcutRow {
  readonly id: string;
  readonly keys: string;
  readonly action: string;
}

/** A group of rows under one heading (e.g. "Edit"). */
export interface ShortcutGroup {
  readonly group: string;
  readonly items: readonly ShortcutRow[];
}

/**
 * Project actions with a display shortcut into the rows the shortcut overlay
 * renders. The overlay also lists pure-gesture rows (mouse drags, single-letter
 * insert keys) that aren't actions — those are kept hand-rolled in the
 * overlay component itself.
 */
export function adaptToShortcutsOverlay(
  actions: readonly EditorAction[],
): readonly ShortcutGroup[] {
  const order: readonly EditorActionGroup[] = ["scenario", "edit", "selection", "view", "help"];
  const buckets = new Map<EditorActionGroup, ShortcutRow[]>();
  for (const g of order) buckets.set(g, []);
  for (const a of actions) {
    if (!a.shortcut) continue;
    const rows = buckets.get(a.group);
    if (!rows) continue;
    rows.push({ id: a.id, keys: a.shortcut, action: a.label });
  }
  const out: ShortcutGroup[] = [];
  for (const g of order) {
    const rows = buckets.get(g) ?? [];
    if (rows.length === 0) continue;
    out.push({ group: GROUP_LABEL[g], items: rows });
  }
  return out;
}
