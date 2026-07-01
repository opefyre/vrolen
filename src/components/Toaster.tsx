import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";

import { useTheme } from "@/lib/theme";

const MOBILE_BREAKPOINT = 640;

/**
 * Project-styled wrapper around Sonner's Toaster.
 *
 * Conventions baked in:
 *   - position: bottom-right on desktop (VROL-1200 — the previous
 *     top-right placement covered the ⌘K palette + theme toggle for
 *     the first 5 seconds on every cold load, so those controls were
 *     unclickable exactly when a new user would try them). Top-center
 *     on mobile so toasts don't fight the narrow-viewport toolbar.
 *   - duration: 5s for success/info; error toasts override per-call
 *   - matches the active theme (light / dark) via useTheme()
 *   - reduced-motion friendly (Sonner handles this automatically)
 *
 * Import the `toast` function from "@/lib/toast" (not from "sonner" directly).
 */
export function Toaster() {
  const { resolved } = useTheme();
  const [isMobile, setIsMobile] = useState<boolean>(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = (): void => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <SonnerToaster
      position={isMobile ? "top-center" : "bottom-right"}
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
