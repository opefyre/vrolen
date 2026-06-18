import { Toaster as SonnerToaster } from "sonner";

import { useTheme } from "@/lib/theme";

/**
 * Project-styled wrapper around Sonner's Toaster.
 *
 * Conventions baked in:
 *   - position: top-right (less intrusive than bottom for a tool that uses
 *     bottom space for command palette / status bar later)
 *   - duration: 5s for success/info; error toasts override per-call
 *   - matches the active theme (light / dark) via useTheme()
 *   - reduced-motion friendly (Sonner handles this automatically)
 *
 * Import the `toast` function from "@/lib/toast" (not from "sonner" directly).
 */
export function Toaster() {
  const { resolved } = useTheme();

  return (
    <SonnerToaster
      position="top-right"
      theme={resolved}
      richColors
      closeButton
      duration={5000}
      toastOptions={{
        classNames: {
          toast: "border-border bg-card text-card-foreground",
        },
      }}
    />
  );
}
