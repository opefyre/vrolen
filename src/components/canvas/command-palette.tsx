/**
 * Cmd+K / Ctrl+K command palette for the editor.
 *
 * A flat list of named actions the user can fuzzy-find and run with
 * the keyboard. Modeled on Figma's Quick Actions and Linear's command
 * palette — type to filter, arrow keys to move, Enter to run.
 *
 * The host (EditorPage) supplies an Action[] each render so the same
 * code that drives the toolbar / context menu also drives the palette
 * — one source of truth, no skewed labels.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export interface CommandAction {
  readonly id: string;
  readonly label: string;
  /** Shown under the label — single short line. */
  readonly hint?: string;
  /** Category badge ("Insert", "View", "Edit", "Run", …). */
  readonly group: string;
  /** Optional ASCII shortcut hint like "⌘D". */
  readonly shortcut?: string;
  /** Disabled actions still show but can't be invoked. */
  readonly disabled?: boolean;
  readonly run: () => void;
}

/**
 * Renders only when open. The parent controls mount/unmount so the
 * component's internal state always starts fresh on each open — no
 * stale query / cursor from a prior session.
 */
interface CommandPaletteProps {
  readonly onClose: () => void;
  readonly actions: readonly CommandAction[];
}

function score(label: string, query: string): number {
  if (!query) return 1;
  const lc = label.toLowerCase();
  const q = query.toLowerCase();
  if (lc === q) return 100;
  if (lc.startsWith(q)) return 50;
  if (lc.includes(q)) return 20;
  // Subsequence fallback so "ad cn" matches "Add connection".
  let idx = 0;
  for (const ch of q) {
    const found = lc.indexOf(ch, idx);
    if (found < 0) return 0;
    idx = found + 1;
  }
  return 5;
}

export function CommandPalette({ onClose, actions }: CommandPaletteProps) {
  // Single state object so the cursor can be reset in the SAME update
  // that changes the query — no follow-up effect needed.
  const [{ query, active }, setState] = useState<{ query: string; active: number }>({
    query: "",
    active: 0,
  });
  const setQuery = (q: string): void => {
    setState({ query: q, active: 0 });
  };
  const setActive = (i: number | ((prev: number) => number)): void => {
    setState((s) => ({ ...s, active: typeof i === "function" ? i(s.active) : i }));
  };
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const ranked = actions
      .map((a) => ({ a, s: score(a.label, query) + (a.hint ? score(a.hint, query) * 0.5 : 0) }))
      .filter(({ s }) => s > 0)
      .sort((x, y) => y.s - x.s);
    return ranked.map(({ a }) => a);
  }, [actions, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cur = filtered[active];
        if (cur && !cur.disabled) {
          cur.run();
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [filtered, active, onClose]);

  // Lock body scroll while the modal is open. The custom overlay isn't
  // backed by shadcn/Radix Dialog so we don't get its scroll-lock for free.
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    // Keep the active row in view.
    const el = listRef.current?.querySelector<HTMLElement>(`[data-cmd-idx="${String(active)}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[60] flex items-start justify-center"
      onPointerDown={(e) => {
        // Click on the backdrop dismisses; clicks inside the panel bubble up only if not stopped.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
        onPointerDown={onClose}
      />
      <div
        className="border-border bg-card text-foreground relative mt-[12vh] w-full max-w-xl overflow-hidden rounded-lg border shadow-2xl"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <span className="text-muted-foreground text-xs">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Type a command, or search…"
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            aria-label="Command search"
          />
          {filtered.length > 0 ? (
            <span className="text-muted-foreground text-[10px]">
              {String(filtered.length)} match{filtered.length === 1 ? "" : "es"}
            </span>
          ) : null}
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-1" role="listbox">
          {filtered.length === 0 ? (
            <div className="text-muted-foreground px-3 py-8 text-center text-sm">
              No matches. Try a different search.
            </div>
          ) : (
            filtered.map((a, i) => {
              const isActive = i === active;
              return (
                <button
                  key={a.id}
                  data-cmd-idx={i}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  disabled={a.disabled}
                  onPointerEnter={() => {
                    setActive(i);
                  }}
                  onClick={() => {
                    if (a.disabled) return;
                    a.run();
                    onClose();
                  }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                    isActive ? "bg-accent" : ""
                  }`}
                >
                  <span className="bg-muted text-muted-foreground inline-flex h-5 min-w-[3.5rem] items-center justify-center rounded px-1.5 text-[10px] font-medium tracking-wide uppercase">
                    {a.group}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{a.label}</span>
                    {a.hint ? (
                      <span className="text-muted-foreground block truncate text-[11px]">
                        {a.hint}
                      </span>
                    ) : null}
                  </span>
                  {a.shortcut ? (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      {a.shortcut}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
