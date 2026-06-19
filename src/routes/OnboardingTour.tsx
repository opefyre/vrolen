/**
 * First-run onboarding tour (VROL-632).
 *
 * A 4-step popover walk-through anchored to DOM elements via
 * `data-tour="..."` attributes in EditorPage. One-time on first visit
 * (gated by `vrolen.onboarding-seen` in localStorage), re-launchable from
 * the toolbar's Help (?) icon any time.
 *
 * Hand-rolled — no tour library. Each step finds its target via
 * `document.querySelector` + getBoundingClientRect, draws a popover
 * positioned next to the target. Resize / scroll observers keep the
 * popover aligned. Click outside or Esc dismisses + marks seen.
 */

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { markOnboardingSeen } from "./onboarding-state";

interface TourStep {
  readonly target: string;
  readonly title: string;
  readonly body: string;
  readonly placement: "right" | "bottom" | "left" | "top";
}

const STEPS: readonly TourStep[] = [
  {
    target: "[data-tour='palette']",
    title: "Build your line",
    body: "Drag a station from the palette onto the canvas. Wire stations by dragging from one handle to another.",
    placement: "right",
  },
  {
    target: "[data-tour='run-settings']",
    title: "Tune the run",
    body: "Horizon, sampler, workers, breakdowns, materials, products — toggle from the Run settings drawer.",
    placement: "bottom",
  },
  {
    target: "[data-tour='run-button']",
    title: "Run the simulation",
    body: "One click. The status pill shows progress; results stream into a panel below the canvas.",
    placement: "bottom",
  },
  {
    target: "[data-tour='scenarios']",
    title: "Save + compare scenarios",
    body: "Capture the current config under a name. Compare any two scenarios side-by-side — charts and all.",
    placement: "bottom",
  },
];

interface OnboardingTourProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

interface TargetRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export function OnboardingTour({ open, onClose }: OnboardingTourProps) {
  const [stepIdx, setStepIdx] = useState<number>(0);
  const [rect, setRect] = useState<TargetRect | null>(null);

  const step = useMemo<TourStep | null>(
    () => (stepIdx < STEPS.length ? (STEPS[stepIdx] ?? null) : null),
    [stepIdx],
  );

  // Track the target element's position so the popover stays glued to it on
  // scroll + resize. Each step swap re-queries the target. The initial
  // measure is deferred via rAF so the effect body doesn't call setState
  // synchronously (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!open || !step) return;
    const measure = (): void => {
      const el = document.querySelector(step.target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const raf = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step]);

  // Esc dismisses the tour.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        markOnboardingSeen();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !step) return null;

  // Compute popover position from the target rect. Falls back to a centered
  // overlay if the target is missing — better than dropping the tour entirely.
  const POP_W = 320;
  const popoverStyle: React.CSSProperties = rect
    ? (() => {
        const margin = 12;
        switch (step.placement) {
          case "right":
            return {
              top: Math.max(16, rect.top + rect.height / 2 - 90),
              left: Math.min(window.innerWidth - POP_W - 16, rect.left + rect.width + margin),
            };
          case "left":
            return {
              top: Math.max(16, rect.top + rect.height / 2 - 90),
              left: Math.max(16, rect.left - POP_W - margin),
            };
          case "top":
            return {
              top: Math.max(16, rect.top - 180 - margin),
              left: Math.max(
                16,
                Math.min(window.innerWidth - POP_W - 16, rect.left + rect.width / 2 - POP_W / 2),
              ),
            };
          case "bottom":
          default:
            return {
              top: rect.top + rect.height + margin,
              left: Math.max(
                16,
                Math.min(window.innerWidth - POP_W - 16, rect.left + rect.width / 2 - POP_W / 2),
              ),
            };
        }
      })()
    : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const isLast = stepIdx === STEPS.length - 1;

  return (
    <>
      {/* Backdrop with a target-shaped cutout. Click anywhere outside the
          popover dismisses the tour. */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
        onClick={() => {
          markOnboardingSeen();
          onClose();
        }}
        aria-hidden
      />
      {/* Highlighted ring around the target. */}
      {rect ? (
        <div
          className="ring-foreground/40 pointer-events-none fixed z-40 rounded-md ring-4 ring-offset-2 ring-offset-transparent"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
            transition: "all 200ms ease",
          }}
          aria-hidden
        />
      ) : null}
      {/* Popover. */}
      <div
        role="dialog"
        aria-label={`Tour step ${String(stepIdx + 1)} of ${String(STEPS.length)}: ${step.title}`}
        className="border-border bg-card fixed z-50 w-80 rounded-lg border p-4 shadow-xl"
        style={popoverStyle}
      >
        <div className="text-muted-foreground mb-2 flex items-center justify-between text-[11px] font-medium tracking-wide uppercase">
          <span>
            Step {stepIdx + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={() => {
              markOnboardingSeen();
              onClose();
            }}
            className="hover:text-foreground"
          >
            Skip tour
          </button>
        </div>
        <div className="font-heading text-base font-semibold">{step.title}</div>
        <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-full ${i === stepIdx ? "bg-foreground" : "bg-muted"}`}
              />
            ))}
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (isLast) {
                markOnboardingSeen();
                onClose();
              } else {
                setStepIdx((i) => i + 1);
              }
            }}
          >
            {isLast ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </>
  );
}
