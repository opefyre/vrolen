/**
 * Coach overlay (VROL-819).
 *
 * Surfaces a single contextual nudge at a time in the bottom-right of the
 * canvas, sitting above the playback bar (mirrors CanvasControls's
 * positioning convention).
 *
 * The component is a pure renderer — it picks the first tip whose
 * `whenVisible()` returns true AND whose id is not in the dismissed set.
 * If `whenVisible()` later flips false, the tip auto-dismisses (no manual
 * close needed). The "Don't show again" link writes the tip id to the
 * persisted dismissed set via `dismissCoachTip`.
 *
 * VROL-813 — the coach renders nothing until the user has Skipped or
 * Finished the first-run OnboardingTour. Both surfaces firing on the
 * same /editor visit overwhelmed first-time users; the tour teaches the
 * core workflow and the coach hands out follow-on micro-nudges, so the
 * coach now waits politely behind `hasSeenOnboarding()`. If the user
 * restarts the tour via the help icon later, the tour-seen flag is
 * already sticky, so the coach keeps running — only the genuine first
 * visit suppresses both surfaces at once.
 */

import type { ReactNode } from "react";
import { useState } from "react";

import { Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { dismissCoachTip, getCoachDismissed } from "@/lib/coach-state";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";
import { hasSeenOnboarding } from "@/routes/onboarding-state";

export interface CoachTipAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface CoachTip {
  readonly id: string;
  readonly title: string;
  readonly body: ReactNode;
  readonly whenVisible: () => boolean;
  readonly action?: CoachTipAction;
}

interface CoachProps {
  readonly tips: readonly CoachTip[];
  readonly className?: string;
}

export function Coach({ tips, className }: CoachProps): ReactNode {
  // Bumping this counter forces a re-read of the dismissed set so the
  // active tip falls away after the user clicks "Don't show again".
  const [dismissedNonce, setDismissedNonce] = useState(0);
  // VROL-801 — skip the right-slide animation when the user prefers
  // reduced motion. The tip still appears; it just doesn't translate in.
  const reducedMotion = useReducedMotion();

  // VROL-813 — suppress the coach entirely until the user has Skipped or
  // Finished the first-run OnboardingTour. The tour and the coach used
  // to fire on the same visit, which felt noisy; defer the coach until
  // the tour's persistence flag flips so a brand-new user only sees the
  // tour. After the tour is done (Skip or Finish both call
  // `markOnboardingSeen`) `hasSeenOnboarding()` returns true on the
  // next render and the coach starts surfacing tips normally. The
  // check sits after the hooks above so the Rules of Hooks aren't
  // violated by a conditional early return.
  if (!hasSeenOnboarding()) return null;

  const dismissed = getCoachDismissed();
  void dismissedNonce; // keep React aware of the dependency

  const active = tips.find((t) => !dismissed.has(t.id) && t.whenVisible());
  if (!active) return null;

  const handleDismiss = (): void => {
    dismissCoachTip(active.id);
    setDismissedNonce((n) => n + 1);
  };

  return (
    <Card
      size="sm"
      data-testid="coach-card"
      data-coach-tip-id={active.id}
      role="status"
      aria-live="polite"
      className={cn(
        // VROL-1219 — was at `bottom-20 right-3` which sat directly under
        // the bottom-right toast (VROL-1200 moved toasts there in
        // Sprint 203). The two overlapped by ~90 px, chopping half the
        // coach body. Bumped to `bottom-36` (~9 rem = 144 px, clears a
        // 100-px toast + 16-px inset with room to spare).
        "absolute right-3 bottom-36 z-30 max-w-[280px] shadow-md",
        reducedMotion ? null : "animate-in slide-in-from-right-2 fade-in-0 duration-300",
        className,
      )}
    >
      <div className="flex items-start gap-2 px-(--card-spacing)">
        <Lightbulb className="text-primary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <div className="font-heading text-sm leading-snug font-medium">{active.title}</div>
          <div className="text-muted-foreground text-xs leading-relaxed">{active.body}</div>
        </div>
      </div>
      {active.action ? (
        <div className="flex justify-end px-(--card-spacing)">
          <Button
            size="xs"
            variant="default"
            onClick={active.action.onClick}
            data-testid="coach-action"
          >
            {active.action.label}
          </Button>
        </div>
      ) : null}
      <div className="flex justify-end px-(--card-spacing) pb-(--card-spacing)">
        <Button
          size="xs"
          variant="link"
          onClick={handleDismiss}
          data-testid="coach-dismiss"
          className="text-muted-foreground hover:text-foreground h-auto px-0 py-0 text-xs"
        >
          Don&apos;t show again
        </Button>
      </div>
    </Card>
  );
}
