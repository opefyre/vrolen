import {
  BookOpen,
  Boxes,
  Factory,
  LayoutGrid,
  Layers,
  Network,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
} from "lucide-react";
import type { ReactNode } from "react";

import { KeyboardShortcutsOverlay } from "@/components/editor/keyboard-shortcuts";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnlineStatus } from "@/lib/online-status";
import { useSidebarCollapsed, toggleSidebar } from "@/lib/sidebar";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof Factory;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home", icon: LayoutGrid },
  { href: "/editor", label: "Editor", icon: Network },
  { href: "/run", label: "Run demo", icon: Play },
  // VROL-442 — /templates entry in the primary nav.
  { href: "/templates", label: "Templates", icon: Layers },
  // VROL-852 — iso renderer sandbox. Surfaced in primary nav while E06 is
  // active so the work is one click away; expected to graduate into /editor
  // once VROL-203/207 land.
  { href: "/iso-demo", label: "Iso demo", icon: Boxes },
  { href: "/help", label: "Glossary", icon: BookOpen },
  { href: "/design-tokens", label: "Design tokens", icon: Palette },
];

interface AppShellProps {
  readonly children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const collapsed = useSidebarCollapsed();
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const online = useOnlineStatus();

  return (
    <div
      data-collapsed={collapsed}
      className="bg-background text-foreground grid h-screen grid-rows-[auto_1fr]"
      style={{
        gridTemplateColumns: collapsed ? "auto 1fr" : "16rem 1fr",
      }}
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
        className="border-border bg-card col-span-2 flex h-14 items-center gap-2 border-b px-4"
        aria-label="Application header"
      >
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

        <a href="/" className="flex items-center gap-2">
          <Factory className="text-primary h-5 w-5" />
          <span className="font-heading text-lg font-semibold tracking-tight">Vrolen</span>
        </a>
        <span className="text-muted-foreground ml-1 font-mono text-xs">
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
          <ThemeToggle />
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className="border-border bg-card col-start-1 row-start-2 row-end-3 hidden border-r p-2 lg:flex lg:flex-col lg:gap-1"
        aria-label="Primary navigation"
      >
        {NAV_ITEMS.map((item) => {
          const active = item.href === pathname;
          const Icon = item.icon;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={[
                "flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                collapsed ? "justify-center" : "",
              ].join(" ")}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </a>
          );
        })}
      </aside>

      {/*
       * VROL-781 — main landmark. `id="main"` is the skip-link target and
       * `tabIndex={-1}` lets the skip link focus it programmatically without
       * adding it to the regular Tab order.
       */}
      <main
        id="main"
        tabIndex={-1}
        aria-label="Main content"
        className="col-start-2 row-start-2 row-end-3 overflow-auto outline-none lg:col-start-2"
      >
        {children}
      </main>
      <KeyboardShortcutsOverlay />
    </div>
  );
}
