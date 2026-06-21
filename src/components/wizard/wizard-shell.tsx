/**
 * Scenario Wizard shell — modal frame, stepper, footer, draft state.
 *
 * Architecture:
 *   - Holds the full WizardDraft state object.
 *   - Renders the active step via a switch on `stepIdx`.
 *   - Step components mutate the draft via the `update` callback.
 *   - Bottom row exposes Back / Skip / Next ; the last step swaps Next
 *     for "Run simulation" with a play glyph.
 *
 * Commitment side-effects (apply preset to editor, run sim) are owned
 * by the host (LandingPage / EditorPage). The shell only invokes the
 * `onFinish(draft)` and `onSkip()` callbacks at the right time.
 */

import { ArrowLeft, ArrowRight, Check, Play, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { StepArrivals } from "./step-arrivals";
import { StepRealism } from "./step-realism";
import { StepReview } from "./step-review";
import { StepShape } from "./step-shape";
import { StepStations } from "./step-stations";
import { type RealismLevel, type WizardDraft, defaultDraft } from "./wizard-types";

interface WizardShellProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onFinish: (draft: WizardDraft, mode: "run" | "open-editor") => void;
}

const STEPS: readonly { readonly title: string; readonly subtitle: string }[] = [
  { title: "Shape", subtitle: "Pick a starting topology" },
  { title: "Stations", subtitle: "Rename + tune cycle times" },
  { title: "Arrivals", subtitle: "Source rate + run length" },
  { title: "Realism", subtitle: "How messy is the world?" },
  { title: "Preview", subtitle: "Review and run" },
];

export function WizardShell(props: WizardShellProps) {
  // Conditionally render with a stable key so each open is a fresh
  // mount; that gives us a clean defaultDraft + stepIdx=0 without an
  // effect that resets state during render.
  return props.open ? <WizardInner {...props} /> : null;
}

function WizardInner({ onClose, onFinish }: WizardShellProps) {
  const [draft, setDraft] = useState<WizardDraft>(() => defaultDraft());
  const [stepIdx, setStepIdx] = useState<number>(0);
  const isLast = stepIdx === STEPS.length - 1;
  const updateDraft = (patch: Partial<WizardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setRealism = (level: RealismLevel) => {
    updateDraft({ realism: level });
  };
  const goBack = () => {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  };
  const goNext = () => {
    if (!isLast) setStepIdx((i) => i + 1);
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New scenario wizard"
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 outline-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        if (e.key === "ArrowLeft") goBack();
        if (e.key === "ArrowRight" && !isLast) goNext();
      }}
    >
      {/* Backdrop is intentionally NOT click-to-dismiss — too easy to bump
          a misplaced footer-Next click outside the modal and lose
          progress. Use the X button or Esc instead. */}
      <div aria-hidden className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="border-border bg-card text-foreground relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border shadow-2xl">
        <Header
          stepIdx={stepIdx}
          steps={STEPS}
          onJump={(i) => {
            if (i < stepIdx) setStepIdx(i);
          }}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto p-5">
          <StepBody stepIdx={stepIdx} draft={draft} update={updateDraft} setRealism={setRealism} />
        </div>
        <Footer
          isFirst={stepIdx === 0}
          isLast={isLast}
          onBack={goBack}
          onSkip={() => {
            onFinish(draft, "open-editor");
            onClose();
          }}
          onNext={goNext}
          onRun={() => {
            onFinish(draft, "run");
            onClose();
          }}
        />
      </div>
    </div>
  );
}

function Header({
  stepIdx,
  steps,
  onJump,
  onClose,
}: {
  readonly stepIdx: number;
  readonly steps: readonly { readonly title: string; readonly subtitle: string }[];
  readonly onJump: (idx: number) => void;
  readonly onClose: () => void;
}) {
  return (
    <div className="border-border border-b px-5 py-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            Step {stepIdx + 1} of {steps.length}
          </div>
          <div className="font-heading text-base font-semibold">{steps[stepIdx]!.title}</div>
          <div className="text-muted-foreground text-xs">{steps[stepIdx]!.subtitle}</div>
        </div>
        <button
          type="button"
          aria-label="Close wizard"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {/* Stepper dots */}
      <div className="mt-3 flex items-center gap-2">
        {steps.map((s, i) => {
          const isCurrent = i === stepIdx;
          const isComplete = i < stepIdx;
          const isFuture = i > stepIdx;
          return (
            <button
              key={s.title}
              type="button"
              disabled={isFuture}
              onClick={() => {
                if (!isFuture) onJump(i);
              }}
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold transition-colors ${
                isCurrent
                  ? "bg-sim-running text-sim-running-foreground"
                  : isComplete
                    ? "bg-sim-running/20 text-sim-running"
                    : "bg-muted text-muted-foreground"
              }`}
              aria-label={`Go to step ${String(i + 1)}: ${s.title}`}
              aria-current={isCurrent ? "step" : undefined}
            >
              {isComplete ? <Check className="h-3 w-3" /> : i + 1}
            </button>
          );
        })}
        <div className="bg-muted relative ml-1 h-1 flex-1 overflow-hidden rounded-full">
          <div
            className="bg-sim-running absolute inset-y-0 left-0 transition-[width]"
            style={{ width: `${String(((stepIdx + 1) / steps.length) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

function StepBody({
  stepIdx,
  draft,
  update,
  setRealism,
}: {
  readonly stepIdx: number;
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly setRealism: (level: RealismLevel) => void;
}): ReactNode {
  switch (stepIdx) {
    case 0:
      return <StepShape draft={draft} update={update} />;
    case 1:
      return <StepStations draft={draft} update={update} />;
    case 2:
      return <StepArrivals draft={draft} update={update} />;
    case 3:
      return <StepRealism draft={draft} setRealism={setRealism} />;
    case 4:
      return <StepReview draft={draft} />;
    default:
      return null;
  }
}

function Footer({
  isFirst,
  isLast,
  onBack,
  onSkip,
  onNext,
  onRun,
}: {
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly onBack: () => void;
  readonly onSkip: () => void;
  readonly onNext: () => void;
  readonly onRun: () => void;
}) {
  return (
    <div className="border-border bg-muted/30 flex items-center justify-between gap-2 border-t px-5 py-3">
      <Button size="sm" variant="ghost" disabled={isFirst} onClick={onBack} className="gap-1">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Button>
      <Button size="sm" variant="ghost" onClick={onSkip} className="text-muted-foreground">
        Skip to editor
      </Button>
      {isLast ? (
        <Button size="sm" onClick={onRun} className="gap-1.5">
          <Play className="h-3.5 w-3.5" />
          Run simulation
        </Button>
      ) : (
        <Button size="sm" onClick={onNext} className="gap-1">
          Next
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
