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
 *
 * VROL-783 — accessibility focus management: focus trap on Tab/Shift+Tab,
 * auto-focus first interactive on open + step change, restore focus on
 * close, Escape closes (preserving draft), aria-labelledby pointing at
 * the step title, and `inert` applied to background siblings so screen
 * readers ignore content behind the modal.
 */

import { ArrowLeft, ArrowRight, Check, Play, Save, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

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

/**
 * VROL-783 — CSS selector for elements treated as focusable inside the
 * wizard. Matches the tabbable npm package's heuristic minus shadow-DOM
 * edge cases we don't need. Filtered further at runtime to skip nodes
 * that are disabled, hidden, `tabIndex={-1}`, or inside an `inert`
 * ancestor.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "audio[controls]",
  "video[controls]",
  "details > summary:first-of-type",
].join(",");

function getTabbable(root: HTMLElement): readonly HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const out: HTMLElement[] = [];
  nodes.forEach((node) => {
    if (node.hasAttribute("disabled")) return;
    if (node.getAttribute("aria-hidden") === "true") return;
    // happy-dom returns 0/0 for everything; skip the visibility check
    // when offsetParent is unavailable so jsdom-style envs still work.
    if (typeof node.offsetParent !== "undefined" && node.offsetParent === null) {
      // Fixed-positioned elements have null offsetParent but are still
      // visible. The dialog is `position: fixed inset-0`, so allow nodes
      // whose computed style says they're not hidden.
      const style =
        typeof window !== "undefined" && typeof window.getComputedStyle === "function"
          ? window.getComputedStyle(node)
          : null;
      if (style && (style.display === "none" || style.visibility === "hidden")) return;
    }
    out.push(node);
  });
  return out;
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
  /** VROL-783 — id wired to the step-title <div> via aria-labelledby. */
  const titleId = useId();
  /** VROL-783 — dialog root + body container refs. The body ref is used
   *  to find the first focusable element on step change so keyboard
   *  users land in the step content, not back at the close button. */
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** VROL-783 — element that had focus when the wizard opened. Captured
   *  once on mount and restored on unmount. */
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
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
  const onSaveAndExit = useCallback(() => {
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
  }, [draft, onClose]);

  /**
   * VROL-783 — capture the previously-focused element on mount and
   * restore focus on unmount. The shell mounts fresh each time the
   * wizard opens (see WizardShell), so this effect runs exactly once
   * per open/close cycle. Restoration happens regardless of which close
   * path was taken (X button, Esc, Save & exit, Run simulation).
   */
  useEffect(() => {
    const previous =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    previouslyFocusedRef.current = previous;
    return () => {
      const target = previouslyFocusedRef.current;
      if (!target || typeof target.focus !== "function" || !target.isConnected) return;
      // Defer one microtask so the inert-sibling cleanup (registered
      // after this effect) has already run; otherwise the trigger may
      // still be inert and focus() would silently no-op.
      queueMicrotask(() => {
        if (!target.isConnected) return;
        try {
          target.focus();
        } catch {
          // Restoration is best-effort — swallow errors silently.
        }
      });
    };
  }, []);

  /**
   * VROL-783 — focus the first interactive element each time the step
   * changes (and on initial mount). Falls back to the dialog root if
   * the body has no tabbable nodes yet.
   */
  useEffect(() => {
    const body = bodyRef.current;
    const dialog = dialogRef.current;
    if (!body || !dialog) return;
    const tabbables = getTabbable(body);
    const target = tabbables[0] ?? dialog;
    // Microtask defer so the new step DOM is wired up before we focus.
    queueMicrotask(() => {
      if (typeof target.focus === "function") {
        target.focus();
      }
    });
  }, [stepIdx]);

  /**
   * VROL-783 — mark every direct child of <body> except the dialog's
   * own root as `inert` while the wizard is open. `inert` is supported
   * natively in all evergreen browsers and removes the subtree from
   * focus order + accessibility tree.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const inerted: HTMLElement[] = [];
    document.body.childNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      if (node.contains(dialog)) return;
      if (node.hasAttribute("inert")) return;
      node.setAttribute("inert", "");
      inerted.push(node);
    });
    return () => {
      inerted.forEach((node) => {
        node.removeAttribute("inert");
      });
    };
  }, []);

  /**
   * VROL-783 — focus trap. Tab from the last focusable wraps to the
   * first; Shift+Tab from the first wraps to the last. Escape closes
   * with the Save & exit semantics (preserve draft, restore focus).
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onSaveAndExit();
      return;
    }
    if (e.key === "ArrowLeft") {
      goBack();
      return;
    }
    if (e.key === "ArrowRight" && !isLast && validation.valid) {
      goNext();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const tabbables = getTabbable(dialog);
    if (tabbables.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = tabbables[0];
    const last = tabbables[tabbables.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey) {
      if (active === first || !dialog.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 outline-none"
      onKeyDown={onKeyDown}
    >
      {/* Backdrop is intentionally NOT click-to-dismiss — too easy to bump
          a misplaced footer-Next click outside the modal and lose
          progress. Use the X button or Esc instead. */}
      <div aria-hidden className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" />
      <div className="border-border bg-card text-foreground relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border shadow-2xl">
        <Header
          stepIdx={stepIdx}
          steps={STEPS}
          titleId={titleId}
          onJump={(i) => {
            if (i < stepIdx) jumpToStep(i);
          }}
          onClose={onClose}
        />
        <div ref={bodyRef} className="flex-1 overflow-y-auto p-5">
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
  titleId,
  onJump,
  onClose,
}: {
  readonly stepIdx: number;
  readonly steps: readonly { readonly title: string; readonly subtitle: string }[];
  readonly titleId: string;
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
          <div id={titleId} className="font-heading text-base font-semibold">
            {steps[stepIdx]!.title}
          </div>
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
