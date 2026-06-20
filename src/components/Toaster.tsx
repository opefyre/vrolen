import { useEffect, useState } from "react";
import { Toaster as SonnerToaster } from "sonner";

import { useTheme } from "@/lib/theme";

const MOBILE_BREAKPOINT = 640;

/**
 * Project-styled wrapper around Sonner's Toaster.
 *
 * Conventions baked in:
 *   - position: top-right on desktop, top-center on mobile (VROL-758) so
 *     toasts don't get clipped or overlap canvas controls on small screens.
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
      position={isMobile ? "top-center" : "top-right"}
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
