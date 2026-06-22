/**
 * VROL-835 — Theme picker dropdown + system echo.
 *
 * Replaces the previous click-to-cycle toggle with a real three-option picker
 * (System / Light / Dark). The trigger icon reflects the EFFECTIVE theme: sun
 * for light, moon for dark, monitor for system. The user's *pick* (not the
 * resolved value) persists to localStorage under `vrolen:theme-pref` so System
 * stays System across reloads even after the OS preference flips.
 *
 * The component also exposes a visually-hidden `aria-live="polite"` region
 * that announces the resolved theme on change so screen-reader users get the
 * same feedback sighted users get from the icon swap.
 */

import { Menu } from "@base-ui/react/menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTheme, type ResolvedTheme, type ThemePreference } from "@/lib/theme";

interface Option {
  readonly value: ThemePreference;
  readonly label: string;
  readonly icon: ReactNode;
}

const OPTIONS: readonly Option[] = [
  { value: "system", label: "System", icon: <Monitor aria-hidden /> },
  { value: "light", label: "Light", icon: <Sun aria-hidden /> },
  { value: "dark", label: "Dark", icon: <Moon aria-hidden /> },
];

function announceText(preference: ThemePreference, resolved: ResolvedTheme): string {
  if (preference === "system") {
    return `Theme set to system (${resolved}).`;
  }
  return `Theme set to ${resolved}.`;
}

/**
 * Compact theme picker. Click opens a 3-option menu. Persistence + the
 * matchMedia hookup live in `@/lib/theme` — this component is purely
 * presentational glue plus an aria-live announcer.
 */
export function ThemeToggle() {
  const { preference, resolved, setPreference } = useTheme();
  const [open, setOpen] = useState(false);

  // VROL-835 — announce on resolved theme change. We hold the latest
  // resolved value in a ref so we can detect the actual transition and
  // populate the live region with the new text only when it changes.
  const [announcement, setAnnouncement] = useState<string>("");
  const lastResolved = useRef<ResolvedTheme | null>(null);
  const lastPreference = useRef<ThemePreference | null>(null);
  useEffect(() => {
    if (lastResolved.current === resolved && lastPreference.current === preference) return;
    // Skip the initial mount announcement — the user did not change anything
    // yet, and screen readers do not need a "theme is light" boilerplate on
    // page load.
    if (lastResolved.current !== null || lastPreference.current !== null) {
      setAnnouncement(announceText(preference, resolved));
    }
    lastResolved.current = resolved;
    lastPreference.current = preference;
  }, [preference, resolved]);

  // VROL-835 — the icon mirrors the EFFECTIVE theme so the chrome reads at
  // a glance: sun ↔ light, moon ↔ dark, monitor ↔ system pick. Rendered
  // inline (not via a destructured component variable) so React's
  // create-components-during-render rule stays happy.
  const triggerIcon =
    preference === "system" ? (
      <Monitor className="h-4 w-4" />
    ) : resolved === "dark" ? (
      <Moon className="h-4 w-4" />
    ) : (
      <Sun className="h-4 w-4" />
    );
  const triggerLabel =
    preference === "system"
      ? `Theme: system (${resolved}). Open theme menu.`
      : `Theme: ${preference}. Open theme menu.`;

  return (
    <>
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Menu.Trigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={triggerLabel}
                    data-testid="theme-toggle"
                  >
                    {triggerIcon}
                  </Button>
                }
              />
            }
          />
          <TooltipContent>Theme</TooltipContent>
        </Tooltip>
        <Menu.Portal>
          <Menu.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-50">
            <Menu.Popup
              className={cn(
                "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                "relative isolate z-50 min-w-[10rem] origin-(--transform-origin) overflow-hidden rounded-lg p-1 shadow-md ring-1",
              )}
            >
              {OPTIONS.map((opt) => {
                const active = opt.value === preference;
                return (
                  <Menu.Item
                    key={opt.value}
                    onClick={() => {
                      setPreference(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none",
                      "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                    )}
                    data-active={active ? "" : undefined}
                  >
                    {opt.icon}
                    <span className="flex-1">{opt.label}</span>
                    {active ? <Check className="absolute right-2 h-4 w-4" aria-hidden /> : null}
                  </Menu.Item>
                );
              })}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      {/* VROL-835 — live announcer. Updates only on a real theme change. */}
      <span aria-live="polite" aria-atomic="true" className="sr-only" data-testid="theme-announcer">
        {announcement}
      </span>
    </>
  );
}
