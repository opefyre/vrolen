/**
 * Global Cmd+K command palette (VROL-817).
 *
 * Mounted at the App root so every route gets a single palette instance.
 * Pressing Cmd+K (Ctrl+K on Win/Linux) opens it from anywhere. Routes can
 * register page-specific actions through `useRegisterCommandActions(...)`;
 * a baseline of navigation + theme actions is always present.
 *
 * Why not a context provider per route: the editor already has its own
 * Cmd+K wired into a richer feature set (insert station, run sim, etc.).
 * The global palette is meant to *route* you somewhere — once you're in
 * /editor, the editor's own palette takes over (it merges these baseline
 * actions in via the same registry). On non-editor routes the global
 * palette is the only one.
 */

import { Command, FileText, Home, Layers, Network, Palette, Play } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { CommandPalette, type CommandAction } from "@/components/canvas/command-palette";
import { navigate } from "@/lib/spa-nav";

interface CommandRegistry {
  /** Stable action source — newest registrant wins on id collision. */
  readonly register: (id: string, actions: readonly CommandAction[]) => () => void;
  /** Current open state — exposed so the editor's Cmd+K wiring can stay in sync. */
  readonly open: boolean;
  readonly setOpen: (next: boolean) => void;
}

const Ctx = createContext<CommandRegistry | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useCommandRegistry(): CommandRegistry {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCommandRegistry must be used inside <GlobalCommandPalette>");
  return v;
}

/**
 * Register a set of actions for the lifetime of the calling component.
 * Returns a tuple [open, setOpen] so callers can also drive the palette
 * (e.g. an "open command palette" button in the editor toolbar).
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useRegisterCommandActions(
  id: string,
  actions: readonly CommandAction[],
): { open: boolean; setOpen: (next: boolean) => void } {
  const reg = useCommandRegistry();
  useEffect(() => {
    const unregister = reg.register(id, actions);
    return unregister;
  }, [id, actions, reg]);
  return { open: reg.open, setOpen: reg.setOpen };
}

/** Baseline always-on actions — routing + a few global toggles. */
function baselineActions(): CommandAction[] {
  // VROL-829 — SPA nav via history.pushState. No more full reloads when
  // jumping routes from the palette.
  const go = (path: string) => () => {
    navigate(path);
  };
  return [
    {
      id: "go-home",
      label: "Go to Home",
      hint: "Landing page + presets",
      group: "Navigate",
      shortcut: "g h",
      run: go("/"),
    },
    {
      id: "go-editor",
      label: "Go to Editor",
      hint: "Scenario authoring",
      group: "Navigate",
      shortcut: "g e",
      run: go("/editor"),
    },
    {
      id: "go-templates",
      label: "Go to Templates",
      hint: "Pre-built scenarios",
      group: "Navigate",
      shortcut: "g t",
      run: go("/templates"),
    },
    {
      id: "go-run",
      label: "Go to Engine playground",
      hint: "Engine demo fixture",
      group: "Navigate",
      shortcut: "g r",
      run: go("/run"),
    },
    {
      id: "go-iso",
      label: "Go to Iso demo",
      hint: "PixiJS isometric sandbox",
      group: "Navigate",
      run: go("/iso-demo"),
    },
    {
      id: "go-glossary",
      label: "Open Glossary",
      hint: "Definitions + concepts",
      group: "Navigate",
      shortcut: "g g",
      run: go("/help"),
    },
    {
      id: "go-design-tokens",
      label: "Open Design tokens",
      hint: "Theme + color debug surface",
      group: "Navigate",
      run: go("/design-tokens"),
    },
  ];
}

/**
 * Top-level palette host. Mount once near the root of <App />.
 * Children get the registry via context.
 */
export function GlobalCommandPalette({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [registrants, setRegistrants] = useState<ReadonlyMap<string, readonly CommandAction[]>>(
    () => new Map(),
  );

  const register = useCallback((id: string, actions: readonly CommandAction[]) => {
    setRegistrants((prev) => {
      const next = new Map(prev);
      next.set(id, actions);
      return next;
    });
    return () => {
      setRegistrants((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    };
  }, []);

  const ctx = useMemo<CommandRegistry>(() => ({ register, open, setOpen }), [register, open]);

  // Cmd+K / Ctrl+K global handler. Ignored in editable targets (forms,
  // contentEditable) so typing in an input doesn't hijack focus.
  //
  // On /editor the editor mounts its OWN richer command palette + Cmd+K
  // listener. Both would otherwise fire and TWO modals would open. Defer
  // to the route-local one when we're on /editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "k" || (!e.metaKey && !e.ctrlKey)) return;
      if (typeof window !== "undefined" && window.location.pathname === "/editor") return;
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (t.isContentEditable) return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Merge baseline + every registrant's actions. Later registrants win on
  // duplicate id (editor's Cmd+S beats the baseline's, for example).
  const actions = useMemo<readonly CommandAction[]>(() => {
    const merged = new Map<string, CommandAction>();
    for (const a of baselineActions()) merged.set(a.id, a);
    for (const list of registrants.values()) {
      for (const a of list) merged.set(a.id, a);
    }
    return Array.from(merged.values());
  }, [registrants]);

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {open ? <CommandPalette onClose={() => setOpen(false)} actions={actions} /> : null}
    </Ctx.Provider>
  );
}

/** Decorative chip shown in the global header — clickable to open the palette. */
export function CommandPaletteHint() {
  const { setOpen } = useCommandRegistry();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Open command palette"
      className="border-border bg-card text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
      title="Open command palette"
    >
      <Command className="h-3 w-3" />
      <span className="font-mono">{isMac ? "⌘ K" : "Ctrl K"}</span>
    </button>
  );
}

// Re-export icon set callers may want to reuse so they don't import lucide
// directly for the small actions handful they pass in. Keeps the registry
// consumers tidy.
// eslint-disable-next-line react-refresh/only-export-components
export const CommandIcons = { Home, Network, Play, Layers, FileText, Palette };
