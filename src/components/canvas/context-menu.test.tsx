/**
 * VROL-775 — pane right-click Insert submenu.
 *
 * Asserts that when CanvasContextMenu opens on the empty pane with an
 * `insertItems` list, the menu surfaces an "Insert" section header and a
 * row per item that runs the corresponding callback on click.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Factory, StickyNote } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  CanvasContextMenu,
  type ContextMenuInsertItem,
  type ContextMenuTarget,
} from "./context-menu";

function paneTarget(): ContextMenuTarget {
  return {
    kind: "pane",
    headerTitle: "1 node",
    clientX: 120,
    clientY: 80,
  };
}

const noop = (): void => {};

describe("CanvasContextMenu pane variant (VROL-775)", () => {
  it("renders an Insert section listing the supplied items", () => {
    const onMachine = vi.fn();
    const onSticky = vi.fn();
    const items: readonly ContextMenuInsertItem[] = [
      { id: "machine", label: "Machine", icon: Factory, run: onMachine },
      { id: "sticky", label: "Sticky note", icon: StickyNote, run: onSticky },
    ];

    render(
      <CanvasContextMenu
        target={paneTarget()}
        onClose={noop}
        onDuplicate={noop}
        onBringToFront={noop}
        onSendToBack={noop}
        onToggleLock={noop}
        onDelete={noop}
        onPaste={noop}
        onSelectAll={noop}
        onFitView={noop}
        onAutoLayout={noop}
        hasClipboard={false}
        insertItems={items}
      />,
    );

    // Section header is uppercase via CSS but the source label is
    // "Insert" — query by text case-insensitively.
    expect(screen.getByText(/^insert$/i)).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /machine/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /sticky note/i })).toBeInTheDocument();
  });

  it("invokes the item's run() and closes when an Insert row is clicked", () => {
    const onMachine = vi.fn();
    const onClose = vi.fn();
    const items: readonly ContextMenuInsertItem[] = [
      { id: "machine", label: "Machine", icon: Factory, run: onMachine },
    ];

    render(
      <CanvasContextMenu
        target={paneTarget()}
        onClose={onClose}
        onDuplicate={noop}
        onBringToFront={noop}
        onSendToBack={noop}
        onToggleLock={noop}
        onDelete={noop}
        onPaste={noop}
        onSelectAll={noop}
        onFitView={noop}
        onAutoLayout={noop}
        hasClipboard={false}
        insertItems={items}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /machine/i }));
    expect(onMachine).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides Paste when no clipboard is set, but keeps Select all + Fit view", () => {
    render(
      <CanvasContextMenu
        target={paneTarget()}
        onClose={noop}
        onDuplicate={noop}
        onBringToFront={noop}
        onSendToBack={noop}
        onToggleLock={noop}
        onDelete={noop}
        onPaste={noop}
        onSelectAll={noop}
        onFitView={noop}
        onAutoLayout={noop}
        hasClipboard={false}
      />,
    );

    expect(screen.queryByRole("menuitem", { name: /^paste$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /select all/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /fit to view/i })).toBeInTheDocument();
  });

  it("shows Paste when clipboard is populated", () => {
    render(
      <CanvasContextMenu
        target={paneTarget()}
        onClose={noop}
        onDuplicate={noop}
        onBringToFront={noop}
        onSendToBack={noop}
        onToggleLock={noop}
        onDelete={noop}
        onPaste={noop}
        onSelectAll={noop}
        onFitView={noop}
        onAutoLayout={noop}
        hasClipboard
      />,
    );

    expect(screen.getByRole("menuitem", { name: /^paste/i })).toBeInTheDocument();
  });
});
