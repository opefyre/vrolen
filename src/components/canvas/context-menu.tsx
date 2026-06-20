/**
 * Right-click context menu for the canvas.
 *
 * On a NODE right-click → Duplicate, Bring to front, Send to back,
 * Lock / Unlock, Delete.
 *
 * On the PANE right-click → Paste (if clipboard has anything),
 * Select all, Fit to view, Auto-layout.
 *
 * Position is fixed to client coords from the contextmenu event.
 * Dismissed by any subsequent click anywhere or by Escape.
 */

import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  Lock,
  Maximize2,
  MousePointerSquareDashed,
  Trash2,
  Unlock,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";

export interface ContextMenuTarget {
  readonly kind: "node" | "pane";
  readonly nodeId?: string;
  readonly isLocked?: boolean;
  readonly clientX: number;
  readonly clientY: number;
}

interface ContextMenuProps {
  readonly target: ContextMenuTarget;
  readonly onClose: () => void;
  readonly onDuplicate: () => void;
  readonly onBringToFront: () => void;
  readonly onSendToBack: () => void;
  readonly onToggleLock: () => void;
  readonly onDelete: () => void;
  readonly onPaste: () => void;
  readonly onSelectAll: () => void;
  readonly onFitView: () => void;
  readonly onAutoLayout: () => void;
  readonly hasClipboard: boolean;
}

function Item({
  icon,
  label,
  shortcut,
  onClick,
  disabled,
  destructive,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly shortcut?: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (!disabled) onClick();
      }}
      className={`hover:bg-accent flex w-full items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-sm disabled:opacity-50 ${
        destructive ? "text-sim-down-foreground hover:text-sim-down-foreground" : ""
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="text-muted-foreground h-3.5 w-3.5 shrink-0">{icon}</span>
        {label}
      </span>
      {shortcut ? (
        <span className="text-muted-foreground font-mono text-[10px]">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function CanvasContextMenu({
  target,
  onClose,
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onToggleLock,
  onDelete,
  onPaste,
  onSelectAll,
  onFitView,
  onAutoLayout,
  hasClipboard,
}: ContextMenuProps) {
  useEffect(() => {
    const onAnyClick = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-canvas-context-menu]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    // Defer one tick so the same click that opened the menu doesn't
    // immediately close it.
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", onAnyClick);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onAnyClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const isNode = target.kind === "node";
  return (
    <div
      data-canvas-context-menu
      role="menu"
      className="border-border bg-card text-foreground fixed z-50 w-56 rounded-md border p-1 shadow-lg"
      style={{ left: target.clientX, top: target.clientY }}
    >
      {isNode ? (
        <>
          <Item
            icon={<Copy />}
            label="Duplicate"
            shortcut="⌘D"
            onClick={() => {
              onDuplicate();
              onClose();
            }}
          />
          <Item
            icon={<ArrowUpToLine />}
            label="Bring to front"
            onClick={() => {
              onBringToFront();
              onClose();
            }}
          />
          <Item
            icon={<ArrowDownToLine />}
            label="Send to back"
            onClick={() => {
              onSendToBack();
              onClose();
            }}
          />
          <Item
            icon={target.isLocked ? <Unlock /> : <Lock />}
            label={target.isLocked ? "Unlock" : "Lock"}
            onClick={() => {
              onToggleLock();
              onClose();
            }}
          />
          <div className="border-border my-1 border-t" />
          <Item
            icon={<Trash2 />}
            label="Delete"
            shortcut="Del"
            destructive
            onClick={() => {
              onDelete();
              onClose();
            }}
          />
        </>
      ) : (
        <>
          <Item
            icon={<ClipboardPaste />}
            label="Paste"
            shortcut="⌘V"
            disabled={!hasClipboard}
            onClick={() => {
              onPaste();
              onClose();
            }}
          />
          <Item
            icon={<MousePointerSquareDashed />}
            label="Select all"
            shortcut="⌘A"
            onClick={() => {
              onSelectAll();
              onClose();
            }}
          />
          <div className="border-border my-1 border-t" />
          <Item
            icon={<Maximize2 />}
            label="Fit to view"
            shortcut="F"
            onClick={() => {
              onFitView();
              onClose();
            }}
          />
          <Item
            icon={<ArrowUpToLine />}
            label="Auto-layout"
            onClick={() => {
              onAutoLayout();
              onClose();
            }}
          />
        </>
      )}
    </div>
  );
}
