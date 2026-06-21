/**
 * Scenario Wizard shell — modal frame, stepper, footer, draft state.
 *
 * Architecture:
 *   - Holds the full WizardDraft state object.
 *   - Renders the active step via a switch on `stepIdx`.
 *   - Step components mutate the draft via the `update` callback.
 *   - Bottom row exposes Back / Save & exit / Next ; the last step swaps Next
 *     for "Run simulation" with a play glyph.
 *
 * Commitment side-effects (apply preset to editor, run sim) are owned
 * by the host (LandingPage / EditorPage). The shell only invokes the
 * `onFinish(draft)` callback at the right time.
 *
 * VROL-820 — per-step validation (Next is disabled until the active
 * step is valid), save-to-draft exits, and a Tweak-section jump from
 * the review step.
 */

import { ArrowLeft, ArrowRight, Check, Play, Save, X } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { saveWizardDraft } from "@/lib/wizard-draft-storage";
import { toast } from "@/lib/toast";

import { StepArrivals } from "./step-arrivals";
import { StepRealism } from "./step-realism";
import { StepReview } from "./step-review";
import { StepShape } from "./step-shape";
import { StepStations } from "./step-stations";
import {
  STEP_VALIDATORS,
  type RealismLevel,
  type WizardDraft,
  type WizardStepValidation,
  defaultDraft,
} from "./wizard-types";

interface WizardShellProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onFinish: (draft: WizardDraft, mode: "run" | "open-editor") => void;
  /**
   * VROL-820 — optional initial draft. The landing page passes a saved
   * draft here when the user clicks "Resume draft"; otherwise the shell
   * starts from `defaultDraft()`.
   */
  readonly initialDraft?: WizardDraft;
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

function WizardInner({ onClose, onFinish, initialDraft }: WizardShellProps) {
  const [draft, setDraft] = useState<WizardDraft>(() => initialDraft ?? defaultDraft());
  const [stepIdx, setStepIdx] = useState<number>(0);
  /** VROL-820 — tracks whether the user has tried to advance from the
   *  current step. We only render inline error messages after they have
   *  attempted Next at least once, so a fresh step doesn't start out
   *  yelling at the user. */
  const [attemptedAdvance, setAttemptedAdvance] = useState<boolean>(false);
  const isLast = stepIdx === STEPS.length - 1;
  const validator = STEP_VALIDATORS[stepIdx];
  const validation: WizardStepValidation = validator
    ? validator(draft)
    : { step: 0, valid: true, errors: {} };
  const showErrors = attemptedAdvance && !validation.valid;
  const stepErrors = showErrors ? validation.errors : ({} as Readonly<Record<string, string>>);
  const updateDraft = (patch: Partial<WizardDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
  };
  const setRealism = (level: RealismLevel) => {
    updateDraft({ realism: level });
  };
  const goBack = () => {
    if (stepIdx > 0) {
      setStepIdx((i) => i - 1);
      setAttemptedAdvance(false);
    }
  };
  const goNext = () => {
    if (isLast) return;
    if (!validation.valid) {
      setAttemptedAdvance(true);
      return;
    }
    setStepIdx((i) => i + 1);
    setAttemptedAdvance(false);
  };
  /** VROL-820 — jump from the review step back to a specific step. */
  const jumpToStep = (idx: number) => {
    if (idx < 0 || idx >= STEPS.length) return;
    setStepIdx(idx);
    setAttemptedAdvance(false);
  };
  /** VROL-820 — persist the draft and bail. Sonner shows an Undo action
   *  that re-opens the wizard at the same step. */
  const onSaveAndExit = () => {
    const ok = saveWizardDraft(draft);
    if (ok) {
      toast.success("Draft saved", {
        description: "Your wizard progress is stored locally.",
        action: {
          label: "Undo",
          onClick: () => {
            window.dispatchEvent(new CustomEvent("vrolen:resume-wizard-draft"));
          },
        },
      });
    } else {
      toast.error("Couldn't save draft", {
        description: "localStorage is unavailable — try again or finish the wizard now.",
      });
    }
    onClose();
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
        if (e.key === "ArrowRight" && !isLast && validation.valid) goNext();
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
            if (i < stepIdx) jumpToStep(i);
          }}
          onClose={onClose}
        />
        <div className="flex-1 overflow-y-auto p-5">
          <StepBody
            stepIdx={stepIdx}
            draft={draft}
            update={updateDraft}
            setRealism={setRealism}
            errors={stepErrors}
            onJump={jumpToStep}
          />
        </div>
        <Footer
          isFirst={stepIdx === 0}
          isLast={isLast}
          canAdvance={validation.valid}
          onBack={goBack}
          onSaveAndExit={onSaveAndExit}
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
  errors,
  onJump,
}: {
  readonly stepIdx: number;
  readonly draft: WizardDraft;
  readonly update: (patch: Partial<WizardDraft>) => void;
  readonly setRealism: (level: RealismLevel) => void;
  readonly errors: Readonly<Record<string, string>>;
  readonly onJump: (idx: number) => void;
}): ReactNode {
  switch (stepIdx) {
    case 0:
      return <StepShape draft={draft} update={update} errors={errors} />;
    case 1:
      return <StepStations draft={draft} update={update} errors={errors} />;
    case 2:
      return <StepArrivals draft={draft} update={update} errors={errors} />;
    case 3:
      return <StepRealism draft={draft} setRealism={setRealism} errors={errors} />;
    case 4:
      return <StepReview draft={draft} onJump={onJump} />;
    default:
      return null;
  }
}

function Footer({
  isFirst,
  isLast,
  canAdvance,
  onBack,
  onSaveAndExit,
  onNext,
  onRun,
}: {
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly canAdvance: boolean;
  readonly onBack: () => void;
  readonly onSaveAndExit: () => void;
  readonly onNext: () => void;
  readonly onRun: () => void;
}) {
  return (
    <div className="border-border bg-muted/30 flex items-center justify-between gap-2 border-t px-5 py-3">
      <Button size="sm" variant="ghost" disabled={isFirst} onClick={onBack} className="gap-1">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onSaveAndExit}
        className="text-muted-foreground gap-1"
      >
        <Save className="h-3.5 w-3.5" />
        Save &amp; exit
      </Button>
      {isLast ? (
        <Button size="sm" onClick={onRun} className="gap-1.5">
          <Play className="h-3.5 w-3.5" />
          Run simulation
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={onNext}
          disabled={!canAdvance}
          aria-disabled={!canAdvance}
          className="gap-1"
        >
          Next
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
