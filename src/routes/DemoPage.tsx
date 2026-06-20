/**
 * VROL-437 — /demo route. Pre-loads the bottling-line preset and bounces
 * the user to /editor with the preset queued. Acts as a one-click
 * entry-point for "show me what this thing does" — landing CTAs and
 * external links can point here without a follow-up click.
 */

import { useEffect } from "react";

import { setPendingPreset } from "@/lib/presets";

const DEMO_PRESET_ID = "bottling-line";

export default function DemoPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPendingPreset(DEMO_PRESET_ID);
    // Replace history so the back button doesn't return to /demo (which
    // would just re-fire this navigation).
    window.location.replace("/editor");
  }, []);
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div className="text-muted-foreground text-sm">Loading demo…</div>
    </div>
  );
}
