import { lazy, Suspense, useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { GlobalCommandPalette } from "@/components/global-command-palette";
import { RouteAnnouncer } from "@/components/RouteAnnouncer";
import { Toaster } from "@/components/Toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { navigate, usePathname } from "@/lib/spa-nav";
import DemoPage from "@/routes/DemoPage";
import DesignTokens from "@/routes/DesignTokens";
import LandingPage from "@/routes/LandingPage";
import LearnPage from "@/routes/LearnPage";
import RunPage from "@/routes/RunPage";
import TemplatesPage from "@/routes/TemplatesPage";

// /editor is the largest route (xyflow + inspector + drawer + per-product UI).
// Lazy-load it so the home page + /run + /design-tokens don't pay for its
// bundle on first visit (VROL-603).
const EditorPage = lazy(() => import("@/routes/EditorPage"));
// /iso-demo ships the PixiJS bundle (~400 KB). Keep it off the critical
// path so the landing page stays light. VROL-852.
const IsoDemoPage = lazy(() => import("@/routes/IsoDemoPage"));

function EditorFallback() {
  return (
    <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
      Loading editor…
    </div>
  );
}

export default function App() {
  // VROL-829 — pathname comes from the SPA-nav store so route changes via
  // history.pushState (no full reload) re-render the page tree.
  const pathname = usePathname();

  // VROL-834 — /help is the legacy route. Redirect to /learn?section=glossary
  // and replace the entry so back doesn't bounce. Runs as an effect so the
  // first render still mounts a valid page (the LearnPage) instead of an
  // intermediate blank frame.
  useEffect(() => {
    if (pathname === "/help") {
      navigate("/learn?section=glossary", { replace: true });
    }
  }, [pathname]);

  let page;
  if (pathname === "/design-tokens") page = <DesignTokens />;
  else if (pathname === "/learn" || pathname === "/help") page = <LearnPage />;
  else if (pathname === "/templates") page = <TemplatesPage />;
  else if (pathname === "/demo") page = <DemoPage />;
  else if (pathname === "/run") page = <RunPage />;
  else if (pathname === "/editor")
    page = (
      <Suspense fallback={<EditorFallback />}>
        <EditorPage />
      </Suspense>
    );
  else if (pathname === "/iso-demo")
    page = (
      <Suspense fallback={<EditorFallback />}>
        <IsoDemoPage />
      </Suspense>
    );
  else page = <LandingPage />;

  return (
    <TooltipProvider>
      <GlobalCommandPalette>
        <AppShell>{page}</AppShell>
        <RouteAnnouncer />
        <Toaster />
      </GlobalCommandPalette>
    </TooltipProvider>
  );
}
