import { lazy, Suspense } from "react";

import { AppShell } from "@/components/AppShell";
import { Toaster } from "@/components/Toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoPage from "@/routes/DemoPage";
import DesignTokens from "@/routes/DesignTokens";
import HelpPage from "@/routes/HelpPage";
import LandingPage from "@/routes/LandingPage";
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
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  let page;
  if (pathname === "/design-tokens") page = <DesignTokens />;
  else if (pathname === "/help") page = <HelpPage />;
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
      <AppShell>{page}</AppShell>
      <Toaster />
    </TooltipProvider>
  );
}
