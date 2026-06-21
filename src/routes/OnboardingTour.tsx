/**
 * First-run onboarding tour — teaching rewrite (VROL-818).
 *
 * The previous tour (VROL-632) labelled UI chunks — "this is the palette",
 * "this is the run button". User research flagged it as cramped, no skip
 * button, and not teaching anyone how to actually use the simulator. This
 * version reframes the 5 steps around the *simulation workflow*:
 *
 *   1. What Vrolen does (discrete-event simulation, find the bottleneck).
 *   2. The graph IS your line — cycle time + buffer determine throughput.
 *   3. Run to see metrics (throughput, OEE, bottleneck).
 *   4. Tweak the bottleneck — identify, modify, re-run, measure.
 *   5. Save scenarios + compare — what-if analysis.
 *
 * Hand-rolled (no tour library). Steps target DOM nodes by `data-tour="..."`
 * attributes; if a target is missing the step skips ahead gracefully and
 * logs a hint to the console rather than dropping the entire tour.
 *
 * Persistence: `hasSeenOnboarding` gates the auto-open; `saveOnboardingStep`
 * persists the current index so a mid-tour reload resumes where the user
 * left off. Skip / Finish call `markOnboardingSeen` which clears the
 * resume-step too.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import {
  clearOnboardingStep,
  loadOnboardingStep,
  markOnboardingSeen,
  saveOnboardingStep,
} from "./onboarding-state";

interface TourStep {
  readonly target: string | null;
  readonly title: string;
  readonly body: string;
  readonly placement: "right" | "bottom" | "left" | "top" | "center";
}

const STEPS: readonly TourStep[] = [
  {
    target: null,
    title: "Welcome to Vrolen",
    body: "Vrolen is a discrete-event simulator for production lines. You sketch your line as a graph, press Run, and we surface the bottleneck — the station that caps how much the whole line can produce. The next four steps show how that works.",
    placement: "center",
  },
  {
    target: "[data-tour='canvas']",
    title: "The graph is your line",
    body: "Each node is a station with a cycle time, and the edges between them carry parts through buffers. Throughput is capped by the slowest station; buffer capacity decides how much variability the line can absorb before earlier stations starve or block.",
    placement: "right",
  },
  {
    target: "[data-tour='run-button']",
    title: "Run to see metrics",
    body: "Pressing Run executes the simulation for the configured horizon. When it finishes you get throughput per hour, OEE, and a callout for the station that bottlenecked the line.",
    placement: "bottom",
  },
  {
    target: "[data-tour='bottleneck-tile']",
    title: "Tweak the bottleneck",
    body: "The workflow loop: find the bottleneck, shorten its cycle time or grow its upstream buffer, re-run, and measure the lift. Improving any other station won't move throughput until the bottleneck moves.",
    placement: "top",
  },
  {
    target: "[data-tour='scenarios-menu']",
    title: "Save scenarios + compare",
    body: "Snapshot the current config as a scenario, then run a variation. The compare view stacks two scenarios side-by-side so you can quantify the lift before committing to a change on the real line.",
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

const POPOVER_WIDTH = 360;
const POPOVER_HEIGHT_ESTIMATE = 200;
const POPOVER_MARGIN = 14;

function clampStep(idx: number): number {
  if (!Number.isFinite(idx)) return 0;
  if (idx < 0) return 0;
  if (idx >= STEPS.length) return STEPS.length - 1;
  return idx;
}

export function OnboardingTour({ open, onClose }: OnboardingTourProps) {
  // Resume from the persisted step on mount. Reads localStorage once; from
  // there the in-memory cache + saveOnboardingStep keep it in sync.
  const [stepIdx, setStepIdx] = useState<number>(() => clampStep(loadOnboardingStep()));
  const [rect, setRect] = useState<TargetRect | null>(null);

  const step = useMemo<TourStep | null>(
    () => (stepIdx < STEPS.length ? (STEPS[stepIdx] ?? null) : null),
    [stepIdx],
  );

  const finish = useCallback((): void => {
    markOnboardingSeen();
    setStepIdx(0);
    onClose();
  }, [onClose]);

  const goNext = useCallback((): void => {
    setStepIdx((i) => {
      const next = i + 1;
      if (next >= STEPS.length) {
        markOnboardingSeen();
        onClose();
        return 0;
      }
      saveOnboardingStep(next);
      return next;
    });
  }, [onClose]);

  const goBack = useCallback((): void => {
    setStepIdx((i) => {
      const prev = Math.max(0, i - 1);
      saveOnboardingStep(prev);
      return prev;
    });
  }, []);

  // Persist the current step on mount/changes — covers the path where the
  // user lands directly on a non-zero resume step.
  useEffect(() => {
    if (!open) return;
    saveOnboardingStep(stepIdx);
  }, [open, stepIdx]);

  // Track the target element's position so the popover stays glued to it on
  // scroll + resize. Each step swap re-queries the target. The initial
  // measure is deferred via rAF so the effect body doesn't call setState
  // synchronously (satisfies react-hooks/set-state-in-effect).
  //
  // If a step's target isn't in the DOM, log once and auto-advance — the
  // user shouldn't get stuck on a step pointing at nothing.
  useEffect(() => {
    if (!open || !step) return;
    const targetSelector = step.target;
    const measure = (): void => {
      if (targetSelector === null) {
        setRect(null);
        return;
      }
      const el = document.querySelector(targetSelector);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    // Defer the initial measure via rAF so setState isn't called
    // synchronously inside the effect body (react-hooks/set-state-in-effect).
    const raf = window.requestAnimationFrame(measure);
    if (targetSelector !== null) {
      window.addEventListener("resize", measure);
      window.addEventListener("scroll", measure, true);
    }
    return () => {
      window.cancelAnimationFrame(raf);
      if (targetSelector !== null) {
        window.removeEventListener("resize", measure);
        window.removeEventListener("scroll", measure, true);
      }
    };
  }, [open, step]);

  // Auto-advance past a missing target (e.g. bottleneck-tile only exists
  // after a run). Wait one frame so the rAF measure above has a chance to
  // find the element before we declare it missing.
  useEffect(() => {
    if (!open || !step || step.target === null) return;
    const raf = window.requestAnimationFrame(() => {
      const el = document.querySelector(step.target as string);
      if (!el) {
        console.info(
          `[OnboardingTour] step ${String(stepIdx + 1)} target ${String(step.target)} missing — skipping ahead`,
        );
        if (stepIdx < STEPS.length - 1) {
          setStepIdx((i) => {
            const next = i + 1;
            saveOnboardingStep(next);
            return next;
          });
        } else {
          markOnboardingSeen();
          onClose();
        }
      }
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [open, step, stepIdx, onClose]);

  // Esc dismisses the tour (treated as Skip).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, finish]);

  // Clear the resume-step on a clean Finish so subsequent re-launches via
  // the help icon restart from the top.
  useEffect(() => {
    if (!open) {
      clearOnboardingStep();
    }
  }, [open]);

  if (!open || !step) return null;

  // Compute popover position from the target rect. Falls back to a centered
  // overlay for the welcome step (no target) and when the target is missing.
  const popoverStyle: React.CSSProperties = (() => {
    if (step.placement === "center" || !rect) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: `${String(POPOVER_WIDTH)}px`,
      };
    }
    const vw = typeof window !== "undefined" ? window.innerWidth : POPOVER_WIDTH;
    const vh = typeof window !== "undefined" ? window.innerHeight : POPOVER_HEIGHT_ESTIMATE;
    // Pick above vs below based on which side has more room — the requested
    // placement is the preference, but we flip it if the viewport disagrees.
    const wantsBelow = step.placement === "bottom";
    const wantsAbove = step.placement === "top";
    const spaceAbove = rect.top;
    const spaceBelow = vh - (rect.top + rect.height);
    let placeBelow = wantsBelow ? true : wantsAbove ? false : spaceBelow >= spaceAbove;
    if (
      placeBelow &&
      spaceBelow < POPOVER_HEIGHT_ESTIMATE &&
      spaceAbove >= POPOVER_HEIGHT_ESTIMATE
    ) {
      placeBelow = false;
    }
    if (
      !placeBelow &&
      spaceAbove < POPOVER_HEIGHT_ESTIMATE &&
      spaceBelow >= POPOVER_HEIGHT_ESTIMATE
    ) {
      placeBelow = true;
    }

    if (step.placement === "left" || step.placement === "right") {
      const top = Math.max(16, Math.min(vh - POPOVER_HEIGHT_ESTIMATE - 16, rect.top));
      if (step.placement === "right") {
        return {
          top,
          left: Math.min(vw - POPOVER_WIDTH - 16, rect.left + rect.width + POPOVER_MARGIN),
          width: `${String(POPOVER_WIDTH)}px`,
        };
      }
      return {
        top,
        left: Math.max(16, rect.left - POPOVER_WIDTH - POPOVER_MARGIN),
        width: `${String(POPOVER_WIDTH)}px`,
      };
    }

    const top = placeBelow
      ? rect.top + rect.height + POPOVER_MARGIN
      : Math.max(16, rect.top - POPOVER_HEIGHT_ESTIMATE - POPOVER_MARGIN);
    const left = Math.max(
      16,
      Math.min(vw - POPOVER_WIDTH - 16, rect.left + rect.width / 2 - POPOVER_WIDTH / 2),
    );
    return { top, left, width: `${String(POPOVER_WIDTH)}px` };
  })();

  const isLast = stepIdx === STEPS.length - 1;
  const isFirst = stepIdx === 0;

  return (
    <>
      {/* Backdrop dim. Click anywhere outside the popover treats it as Skip
          — matches the Esc and the explicit Skip link. */}
      <div
        className="bg-foreground/40 fixed inset-0 z-40 backdrop-blur-[1px]"
        onClick={finish}
        aria-hidden
      />
      {/* Soft ring around the highlighted target + faint pulse so the user
          can see what's being pointed at. Skipped on the welcome step. */}
      {rect ? (
        <div
          className="ring-primary pointer-events-none fixed z-40 animate-pulse rounded-md ring-2 ring-offset-2 ring-offset-transparent"
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
        aria-modal="true"
        aria-label={`Tour step ${String(stepIdx + 1)} of ${String(STEPS.length)}: ${step.title}`}
        className="border-border bg-card fixed z-50 max-w-[360px] rounded-lg border p-5 shadow-xl"
        style={popoverStyle}
      >
        <div className="text-muted-foreground mb-2 flex items-center justify-between text-[11px] font-medium tracking-wide uppercase">
          <span>
            {stepIdx + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            onClick={finish}
            className="hover:text-foreground text-[11px] tracking-wide uppercase underline-offset-2 hover:underline"
          >
            Skip tour
          </button>
        </div>
        <div className="font-heading text-base font-semibold">{step.title}</div>
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{step.body}</p>
        <div className="mt-5 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-6 rounded-full ${i === stepIdx ? "bg-foreground" : "bg-muted"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={goBack} disabled={isFirst}>
              Back
            </Button>
            <Button size="sm" onClick={goNext}>
              {isLast ? "Finish" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// FIXME(VROL-818) — EditorPage needs these `data-tour` attributes for the
// new teaching tour. They live in EditorPage.tsx and aren't safe to touch
// from this agent (parallel work in progress). When merging this branch,
// add:
//   - data-tour="canvas"          on the react-flow ReactFlow wrapper
//                                  (the canvas Card body — likely near the
//                                   existing data-tour="palette" sibling).
//   - data-tour="bottleneck-tile" on the bottleneck callout tile inside
//                                  ResultPanel.tsx (the station name + ms
//                                  cycle-time chip). Falls back gracefully
//                                  if absent (the step auto-skips).
//   - data-tour="scenarios-menu"  on the Scenarios dropdown trigger
//                                  (currently the element already tagged
//                                   data-tour="scenarios" — rename, or add
//                                   the alias).
// The existing data-tour="run-button" is reused as-is.
