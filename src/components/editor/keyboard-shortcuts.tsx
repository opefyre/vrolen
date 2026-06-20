/**
 * VROL-673 — keyboard shortcuts overlay. Press "?" to open. Lists every
 * shortcut the editor responds to so users can discover them without
 * having to read source. Closes on Escape or clicking outside.
 */

import { useEffect, useState } from "react";

interface Shortcut {
  readonly keys: string;
  readonly action: string;
}

const SHORTCUTS: readonly { readonly group: string; readonly items: readonly Shortcut[] }[] = [
  {
    group: "Editor",
    items: [
      { keys: "⌘Z / Ctrl+Z", action: "Undo last edit" },
      { keys: "⇧⌘Z / Ctrl+Shift+Z", action: "Redo" },
      { keys: "?", action: "Open this shortcuts panel" },
    ],
  },
  {
    group: "Canvas",
    items: [
      { keys: "Click", action: "Select a station" },
      { keys: "Shift + Click", action: "Multi-select for bulk edit" },
      { keys: "Drag", action: "Pan the canvas" },
      { keys: "Scroll", action: "Zoom" },
    ],
  },
];

export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);
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
          {SHORTCUTS.map((g) => (
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
