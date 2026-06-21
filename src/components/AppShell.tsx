import {
  BookOpen,
  Boxes,
  Factory,
  LayoutGrid,
  Layers,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
} from "lucide-react";
import { useState, type CSSProperties, type ReactNode } from "react";

import { KeyboardShortcutsOverlay } from "@/components/editor/keyboard-shortcuts";
import { CommandPaletteHint } from "@/components/global-command-palette";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnlineStatus } from "@/lib/online-status";
import { useSidebarCollapsed, toggleSidebar } from "@/lib/sidebar";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof Factory;
  /** VROL-826 — keyboard shortcut hint shown in the sidebar tooltip. */
  readonly shortcut?: string;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home", icon: LayoutGrid, shortcut: "g h" },
  { href: "/editor", label: "Editor", icon: Network, shortcut: "g e" },
  { href: "/run", label: "Engine playground", icon: Play, shortcut: "g r" },
  // VROL-442 — /templates entry in the primary nav.
  { href: "/templates", label: "Templates", icon: Layers, shortcut: "g t" },
  // VROL-852 — iso renderer sandbox. Surfaced in primary nav while E06 is
  // active so the work is one click away; expected to graduate into /editor
  // once VROL-203/207 land.
  { href: "/iso-demo", label: "Iso demo", icon: Boxes },
  { href: "/help", label: "Glossary", icon: BookOpen, shortcut: "g g" },
  // VROL-825 — Design tokens moved out of the primary nav. It's a debug
  // surface, not a user-facing route. Reachable via Cmd+K and the footer.
];

interface AppShellProps {
  readonly children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useSidebarCollapsed();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const online = useOnlineStatus();
  // VROL-782 — mobile drawer state. Below the lg breakpoint the persistent
  // sidebar is hidden; this Sheet replaces it. Closes on nav-link click so
  // the user lands on the new page without an obscuring overlay.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // VROL-782 — grid template columns are driven by a CSS variable so the
  // responsive switch can happen in Tailwind (single column below `lg`,
  // sidebar + content above). The variable encodes the desktop layout —
  // its expanded vs collapsed sidebar width.
  const shellStyle = {
    "--vrolen-sidebar-cols": collapsed ? "auto 1fr" : "16rem 1fr",
  } as CSSProperties;

  return (
    <div
      data-collapsed={collapsed}
      className="bg-background text-foreground grid h-screen grid-cols-1 grid-rows-[auto_1fr] lg:[grid-template-columns:var(--vrolen-sidebar-cols)]"
      style={shellStyle}
    >
      {/*
       * VROL-781 — skip link. First focusable element so keyboard users can
       * jump past the persistent header + sidebar straight to page content.
       * Visually hidden until focused via Tailwind's `sr-only focus:not-sr-only`.
       */}
      <a
        href="#main"
        className="focus:bg-background focus:text-foreground focus:border-border focus-visible:ring-ring sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:border focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md focus:outline-none focus-visible:ring-2"
      >
        Skip to main content
      </a>

      {/* Header */}
      <header
        className="border-border bg-card col-span-1 flex h-14 items-center gap-2 border-b px-4 lg:col-span-2"
        aria-label="Application header"
      >
        {/*
         * VROL-782 — collapse-sidebar toggle only makes sense when the
         * persistent desktop sidebar is visible. Hidden below `lg`.
         */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                onClick={() => {
                  toggleSidebar();
                }}
                className="hidden lg:inline-flex"
              >
                {collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )}
              </Button>
            }
          />
          <TooltipContent>{collapsed ? "Expand sidebar" : "Collapse sidebar"}</TooltipContent>
        </Tooltip>

        {/*
         * VROL-782 — mobile hamburger. Replaces the missing desktop sidebar
         * below `lg`. Opens the Sheet drawer that mirrors NAV_ITEMS.
         */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          onClick={() => {
            setDrawerOpen(true);
          }}
          className="lg:hidden"
          data-testid="mobile-nav-trigger"
        >
          <Menu className="h-4 w-4" />
        </Button>

        <a href="/" className="flex items-center gap-2">
          <Factory className="text-primary h-5 w-5" />
          <span className="font-heading text-lg font-semibold tracking-tight">Vrolen</span>
        </a>
        <span className="text-muted-foreground ml-1 hidden font-mono text-xs sm:inline">
          production-line simulator
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* VROL-428 — offline indicator. Hidden when online. */}
          {!online ? (
            <span
              className="bg-sim-down/15 text-sim-down-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
              title="Offline — saves persist locally; cloud sync paused"
              aria-live="polite"
              data-testid="offline-indicator"
            >
              <span className="bg-sim-down h-1.5 w-1.5 rounded-full" aria-hidden />
              Offline
            </span>
          ) : null}
          {/* VROL-817 — global Cmd+K hint chip. Click to open the palette
              from any route (or hit Cmd+K / Ctrl+K). */}
          <CommandPaletteHint />
          <ThemeToggle />
        </div>
      </header>

      {/* Sidebar — desktop only (≥ lg). Mobile gets the Sheet below. */}
      <aside
        className="border-border bg-card col-start-1 row-start-2 row-end-3 hidden border-r p-2 lg:flex lg:flex-col lg:gap-1"
        aria-label="Primary navigation"
      >
        {NAV_ITEMS.map((item) => {
          const active = item.href === pathname;
          const Icon = item.icon;
          // VROL-826 — Tooltip on every nav item with the keyboard shortcut.
          // Replaces the native `title` attr so we get consistent styling +
          // dismiss-on-Esc + reduced-motion respect from shadcn.
          const link = (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
              className={[
                "flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                collapsed ? "justify-center" : "",
              ].join(" ")}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger render={link} />
              <TooltipContent>
                <span className="inline-flex items-center gap-2">
                  {item.label}
                  {item.shortcut ? (
                    <kbd className="border-border bg-card text-foreground rounded-sm border px-1 font-mono text-[10px]">
                      {item.shortcut}
                    </kbd>
                  ) : null}
                </span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </aside>

      {/*
       * VROL-782 — mobile nav drawer. Mirrors NAV_ITEMS so the two surfaces
       * stay in sync (factoring the list into a constant rather than
       * duplicating it). Closes on link click so the user lands on the new
       * route without an overlay.
       */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          className="flex w-[80vw] flex-col gap-0 p-0 sm:max-w-[320px]"
          data-testid="mobile-nav-drawer"
        >
          <SheetHeader className="border-border border-b p-4">
            <SheetTitle className="flex items-center gap-2">
              <Factory className="text-primary h-5 w-5" aria-hidden />
              <span className="font-heading text-lg font-semibold tracking-tight">Vrolen</span>
            </SheetTitle>
            <SheetDescription className="font-mono text-xs">
              production-line simulator
            </SheetDescription>
          </SheetHeader>
          <nav
            aria-label="Primary navigation"
            className="flex flex-1 flex-col gap-1 overflow-y-auto p-2"
          >
            {NAV_ITEMS.map((item) => {
              const active = item.href === pathname;
              const Icon = item.icon;
              return (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  aria-label={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
                  onClick={() => {
                    setDrawerOpen(false);
                  }}
                  className={[
                    "flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" aria-hidden />
                    {item.label}
                  </span>
                  {item.shortcut ? (
                    <kbd className="border-border bg-card text-foreground rounded-sm border px-1 font-mono text-[10px]">
                      {item.shortcut}
                    </kbd>
                  ) : null}
                </a>
              );
            })}
          </nav>
          {/*
           * VROL-782 — drawer footer parity row. The slim mobile header only
           * has room for the hamburger + wordmark, so the offline indicator,
           * command-palette hint, and theme toggle live in the drawer.
           */}
          <div className="border-border flex items-center gap-2 border-t p-3">
            {!online ? (
              <span
                className="bg-sim-down/15 text-sim-down-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                title="Offline — saves persist locally; cloud sync paused"
                aria-live="polite"
                data-testid="offline-indicator-drawer"
              >
                <span className="bg-sim-down h-1.5 w-1.5 rounded-full" aria-hidden />
                Offline
              </span>
            ) : null}
            <CommandPaletteHint />
            <ThemeToggle />
          </div>
        </SheetContent>
      </Sheet>

      {/*
       * VROL-781 — main landmark. `id="main"` is the skip-link target and
       * `tabIndex={-1}` lets the skip link focus it programmatically without
       * adding it to the regular Tab order.
       *
       * VROL-782 — below `lg` the grid is single-column so `main` lives at
       * col 1; at `lg` and above the sidebar takes col 1 and main slides to
       * col 2.
       */}
      <main
        id="main"
        tabIndex={-1}
        aria-label="Main content"
        className="col-start-1 row-start-2 row-end-3 overflow-auto outline-none lg:col-start-2"
      >
        {children}
      </main>
      <KeyboardShortcutsOverlay />
    </div>
  );
}
