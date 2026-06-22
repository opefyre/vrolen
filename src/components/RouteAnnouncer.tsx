import { useEffect } from "react";

import { getRouteMeta } from "@/lib/route-meta";
import { usePathname } from "@/lib/spa-nav";

/**
 * VROL-806 — Updates `document.title` on every route change and exposes a
 * visually-hidden aria-live region so screen readers announce the new page.
 *
 * Mounted once near the root of the app (next to `<Toaster />`). It does not
 * render anything visible — the `sr-only` div is for assistive tech only.
 */
export function RouteAnnouncer() {
  const pathname = usePathname();
  const { title } = getRouteMeta(pathname);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = title;
  }, [title]);

  return (
    <div role="status" aria-live="polite" className="sr-only">
      {title}
    </div>
  );
}
