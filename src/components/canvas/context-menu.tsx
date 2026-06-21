/**
 * Canvas context menu — right-click on a node / edge / pane.
 *
 * Polished pass (Sprint 83):
 *   • Header strip names what was right-clicked (node label, "A → B", etc.)
 *   • Section grouping with thin dividers, not single-tone walls of items
 *   • Destructive items stay neutral until hover/focus, then go red — fixes
 *     the unreadable always-pink "Delete" text from the previous build
 *   • Arrow-key navigation + Enter to activate
 *   • Stronger shadow + 1px border in popover token (matches Sheets)
 */

import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  Edit3,
  Hash,
  Lock,
  Maximize2,
  MousePointerSquareDashed,
  Sparkles,
  Trash2,
  Unlock,
  Workflow,
  XCircle,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

export interface ContextMenuTarget {
  readonly kind: "node" | "pane" | "edge";
  readonly nodeId?: string;
  readonly edgeId?: string;
  readonly isLocked?: boolean;
  /** Short label shown in the popover header strip. */
  readonly headerTitle?: string;
  /** One-line sub-label (e.g. "Filler A → Capper"). */
  readonly headerSubtitle?: string;
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
  readonly onReverseEdge?: () => void;
  readonly onDeleteEdge?: () => void;
  readonly onRename?: () => void;
  readonly hasClipboard: boolean;
}

interface MenuItemSpec {
  readonly id: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly shortcut?: string;
  readonly destructive?: boolean;
  readonly run: () => void;
}

interface MenuSection {
  readonly id: string;
  readonly label?: string;
  readonly items: readonly MenuItemSpec[];
}

function MenuRow({
  spec,
  active,
  onActivate,
  onHover,
}: {
  readonly spec: MenuItemSpec;
  readonly active: boolean;
  readonly onActivate: () => void;
  readonly onHover: () => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="menuitem"
      onClick={onActivate}
      onMouseEnter={onHover}
      onFocus={onHover}
      data-destructive={spec.destructive ? "true" : undefined}
      className={[
        "group flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors outline-none",
        active ? "bg-accent" : "hover:bg-accent/70",
        spec.destructive
          ? active
            ? "text-destructive"
            : "text-foreground hover:text-destructive"
          : "text-foreground",
      ].join(" ")}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={[
            "flex h-4 w-4 shrink-0 items-center justify-center",
            spec.destructive
              ? active
                ? "text-destructive"
                : "text-muted-foreground group-hover:text-destructive"
              : "text-muted-foreground group-hover:text-foreground",
          ].join(" ")}
          aria-hidden
        >
          {spec.icon}
        </span>
        <span className="font-medium">{spec.label}</span>
      </span>
      {spec.shortcut ? (
        <span
          className={[
            "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
            spec.destructive
              ? active
                ? "border-destructive/30 text-destructive"
                : "border-border text-muted-foreground"
              : active
                ? "border-foreground/20 text-foreground"
                : "border-border text-muted-foreground",
          ].join(" ")}
        >
          {spec.shortcut}
        </span>
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
  onReverseEdge,
  onDeleteEdge,
  onRename,
  hasClipboard,
}: ContextMenuProps) {
  // Build the section list from the target kind so all rendering logic
  // stays uniform (no nested ternaries in JSX).
  const sections: readonly MenuSection[] =
    target.kind === "node"
      ? [
          {
            id: "edit",
            items: [
              ...(onRename
                ? [
                    {
                      id: "rename",
                      icon: <Edit3 className="h-3.5 w-3.5" />,
                      label: "Rename",
                      shortcut: "F2",
                      run: onRename,
                    },
                  ]
                : []),
              {
                id: "duplicate",
                icon: <Copy className="h-3.5 w-3.5" />,
                label: "Duplicate",
                shortcut: "⌘D",
                run: onDuplicate,
              },
            ],
          },
          {
            id: "arrange",
            label: "Arrange",
            items: [
              {
                id: "front",
                icon: <ArrowUpToLine className="h-3.5 w-3.5" />,
                label: "Bring to front",
                run: onBringToFront,
              },
              {
                id: "back",
                icon: <ArrowDownToLine className="h-3.5 w-3.5" />,
                label: "Send to back",
                run: onSendToBack,
              },
              {
                id: "lock",
                icon: target.isLocked ? (
                  <Unlock className="h-3.5 w-3.5" />
                ) : (
                  <Lock className="h-3.5 w-3.5" />
                ),
                label: target.isLocked ? "Unlock position" : "Lock position",
                run: onToggleLock,
              },
            ],
          },
          {
            id: "danger",
            items: [
              {
                id: "delete",
                icon: <Trash2 className="h-3.5 w-3.5" />,
                label: "Delete",
                shortcut: "Del",
                destructive: true,
                run: onDelete,
              },
            ],
          },
        ]
      : target.kind === "edge"
        ? [
            {
              id: "edit",
              items: [
                {
                  id: "reverse",
                  icon: <ArrowLeftRight className="h-3.5 w-3.5" />,
                  label: "Reverse direction",
                  run: onReverseEdge ?? (() => {}),
                },
              ],
            },
            {
              id: "danger",
              items: [
                {
                  id: "delete-edge",
                  icon: <Trash2 className="h-3.5 w-3.5" />,
                  label: "Delete edge",
                  shortcut: "Del",
                  destructive: true,
                  run: onDeleteEdge ?? (() => {}),
                },
              ],
            },
          ]
        : [
            {
              id: "clipboard",
              items: [
                {
                  id: "paste",
                  icon: <ClipboardPaste className="h-3.5 w-3.5" />,
                  label: "Paste",
                  shortcut: "⌘V",
                  run: hasClipboard ? onPaste : () => {},
                },
                {
                  id: "select-all",
                  icon: <MousePointerSquareDashed className="h-3.5 w-3.5" />,
                  label: "Select all",
                  shortcut: "⌘A",
                  run: onSelectAll,
                },
              ],
            },
            {
              id: "view",
              label: "View",
              items: [
                {
                  id: "fit",
                  icon: <Maximize2 className="h-3.5 w-3.5" />,
                  label: "Fit to view",
                  shortcut: "F",
                  run: onFitView,
                },
                {
                  id: "auto",
                  icon: <Sparkles className="h-3.5 w-3.5" />,
                  label: "Auto-layout",
                  run: onAutoLayout,
                },
              ],
            },
          ];

  const flatItems = sections.flatMap((s) => s.items);

  // Arrow-key navigation. Defaults to the first non-destructive item so a
  // stray Enter never deletes anything.
  const initial = Math.max(
    0,
    flatItems.findIndex((it) => !it.destructive),
  );
  const [activeIdx, setActiveIdx] = useState<number>(initial);

  useEffect(() => {
    const onAnyClick = (e: MouseEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-canvas-context-menu]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % flatItems.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + flatItems.length) % flatItems.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flatItems[activeIdx];
        if (item) {
          item.run();
          onClose();
        }
      }
    };
    const id = setTimeout(() => {
      window.addEventListener("pointerdown", onAnyClick);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("pointerdown", onAnyClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, flatItems, activeIdx]);

  // Position with viewport clamping so the menu never spills off the edge.
  const MENU_W = 232;
  const MENU_H_EST = 60 + sections.length * 30 + flatItems.length * 32;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(target.clientX, Math.max(8, vw - MENU_W - 8));
  const top = Math.min(target.clientY, Math.max(8, vh - MENU_H_EST - 8));

  const headerIcon =
    target.kind === "node" ? (
      <Hash className="h-3 w-3" />
    ) : target.kind === "edge" ? (
      <Workflow className="h-3 w-3" />
    ) : (
      <XCircle className="h-3 w-3" />
    );
  const headerKindLabel =
    target.kind === "node" ? "Node" : target.kind === "edge" ? "Edge" : "Canvas";
  const headerMainLabel = target.headerTitle ?? null;
  const headerSubLabel = target.headerSubtitle ?? null;

  let rowOffset = 0;
  return (
    <div
      data-canvas-context-menu
      role="menu"
      aria-label={`${headerKindLabel} actions`}
      className="border-border bg-popover text-popover-foreground fixed z-50 w-58 overflow-hidden rounded-xl border shadow-xl ring-1 ring-black/5 backdrop-blur-sm"
      style={{ left, top, width: MENU_W }}
    >
      {/* Header strip — names what was right-clicked. */}
      <div className="border-border bg-muted/40 border-b px-3 py-2">
        <div className="text-muted-foreground flex items-center gap-1.5 text-[10px] font-medium tracking-wide uppercase">
          {headerIcon}
          <span>{headerKindLabel}</span>
        </div>
        {headerMainLabel ? (
          <div
            className="text-foreground mt-0.5 truncate text-[13px] font-semibold"
            title={headerMainLabel}
          >
            {headerMainLabel}
          </div>
        ) : null}
        {headerSubLabel ? (
          <div
            className="text-muted-foreground truncate font-mono text-[10px]"
            title={headerSubLabel}
          >
            {headerSubLabel}
          </div>
        ) : null}
      </div>
      <div className="p-1">
        {sections.map((section, sIdx) => {
          const isFirstSection = sIdx === 0;
          const sectionEl = (
            <div
              key={section.id}
              className={isFirstSection ? "" : "border-border mt-1 border-t pt-1"}
            >
              {section.label ? (
                <div className="text-muted-foreground px-2 py-0.5 text-[9px] font-semibold tracking-wider uppercase">
                  {section.label}
                </div>
              ) : null}
              {section.items.map((item, iIdx) => {
                const flatIdx = rowOffset + iIdx;
                return (
                  <MenuRow
                    key={item.id}
                    spec={item}
                    active={activeIdx === flatIdx}
                    onActivate={() => {
                      item.run();
                      onClose();
                    }}
                    onHover={() => setActiveIdx(flatIdx)}
                  />
                );
              })}
            </div>
          );
          rowOffset += section.items.length;
          return sectionEl;
        })}
      </div>
    </div>
  );
}
