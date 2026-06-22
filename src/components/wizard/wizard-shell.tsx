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
 *
 * VROL-827 — "Create scenario" no longer closes the modal immediately.
 * It transitions into a 4-step progress sequence (Building → Validating →
 * Running first replication → Compiling KPIs) that performs real work
 * (commitDraft, validateScenario, handoff write) paced at ~400ms per
 * phase, then lands on a success screen with an "Open scenario" CTA that
 * fires `onFinish(draft, "open-editor")`. If validateScenario surfaces
 * errors, the sequence breaks into an error state with jump-back buttons
 * to the offending step (review step = idx 7 fallback).
 */

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  Play,
  Save,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { mergeWithDefaults } from "@/routes/editor-run-settings";
import { saveWizardDraft } from "@/lib/wizard-draft-storage";
import { toast } from "@/lib/toast";
import { validateScenario, type ValidationIssue } from "@/lib/validate-scenario";

import { commitDraft } from "./commit-draft";
import { StepArrivals } from "./step-arrivals";
import { StepConnections } from "./step-connections";
import { StepProducts } from "./step-products";
import { StepRealism } from "./step-realism";
import { StepReview } from "./step-review";
import { StepRunWindow } from "./step-run-window";
import { StepShape } from "./step-shape";
import { StepStations } from "./step-stations";
import {
  STEP_VALIDATORS,
  type RealismLevel,
  type WizardCommit,
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
  /**
   * VROL-827 — testing hook. The progress sequence paces each phase at
   * ~400ms so the user can see what's happening; specs that want to
   * fast-forward it pass 0 here. Production callers leave this undefined.
   */
  readonly progressPhaseMs?: number;
}

const STEPS: readonly { readonly title: string; readonly subtitle: string }[] = [
  { title: "Shape", subtitle: "Pick a starting topology" },
  { title: "Stations", subtitle: "Author each station's parameters" },
  { title: "Connections", subtitle: "Wire stations into a DAG" },
  { title: "Products", subtitle: "Recipe + changeovers" },
  { title: "Realism", subtitle: "Breakdowns, maintenance, workers" },
  { title: "Arrivals", subtitle: "Source + materials" },
  { title: "Run window", subtitle: "Horizon, warm-up, replications" },
  { title: "Review", subtitle: "Confirm and create" },
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

/**
 * VROL-827 — the phases of the in-modal progress sequence. "authoring" is
 * the default; "running" walks the 4 progress phases; "success" lands on
 * the final screen with the "Open scenario" CTA; "error" surfaces a
 * validation summary with jump-back links.
 */
type WizardPhase =
  | { readonly kind: "authoring" }
  | { readonly kind: "running"; readonly phaseIdx: number }
  | { readonly kind: "success"; readonly commit: WizardCommit }
  | { readonly kind: "error"; readonly errors: readonly ValidationIssue[] };

/** VROL-827 — labels for the 4 progress phases, in execution order. */
const PROGRESS_PHASES: readonly string[] = [
  "Building scenario",
  "Validating",
  "Running first replication",
  "Compiling KPIs",
];

const DEFAULT_PROGRESS_PHASE_MS = 400;

function WizardInner({ onClose, onFinish, initialDraft, progressPhaseMs }: WizardShellProps) {
  const [draft, setDraft] = useState<WizardDraft>(() => initialDraft ?? defaultDraft());
  const [stepIdx, setStepIdx] = useState<number>(0);
  /** VROL-827 — the wizard's mode. "authoring" while the user is editing
   *  step 1..8; switches to "running" → "success" / "error" on Create. */
  const [phase, setPhase] = useState<WizardPhase>({ kind: "authoring" });
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
  /** VROL-827 — cached commit so phases 2..4 don't have to re-run
   *  commitDraft. Populated by phase 1, consumed thereafter. */
  const commitCacheRef = useRef<WizardCommit | null>(null);
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
   * VROL-827 — kick off the 4-step progress sequence on "Create scenario".
   * Each phase performs a real check (commitDraft, validateScenario, the
   * setPendingWizardCommit handoff, a final KPI-ready audit) and is paced
   * at `progressPhaseMs` (default ~400ms) so the user can read the label
   * before it advances.
   *
   * If validateScenario surfaces hard errors the sequence breaks into the
   * "error" phase and the user can jump back to the offending step — we
   * deliberately do NOT call `onFinish` in that case so the host never
   * sees a half-baked handoff.
   */
  const phaseMs = progressPhaseMs ?? DEFAULT_PROGRESS_PHASE_MS;
  const startProgress = useCallback(() => {
    setPhase({ kind: "running", phaseIdx: 0 });
  }, []);

  useEffect(() => {
    if (phase.kind !== "running") return;
    let cancelled = false;
    const advance = (next: WizardPhase): void => {
      if (cancelled) return;
      setPhase(next);
    };
    const sleep = (ms: number): Promise<void> =>
      new Promise<void>((resolve) => {
        if (ms <= 0) {
          resolve();
          return;
        }
        window.setTimeout(resolve, ms);
      });
    void (async () => {
      try {
        if (phase.phaseIdx === 0) {
          // Phase 1 — Building scenario. Real work: commitDraft.
          const commit = commitDraft(draft);
          await sleep(phaseMs);
          if (cancelled) return;
          commitCacheRef.current = commit;
          advance({ kind: "running", phaseIdx: 1 });
        } else if (phase.phaseIdx === 1) {
          // Phase 2 — Validating. Real work: validateScenario over the
          // committed nodes + edges + a merged RunSettings.
          const commit = commitCacheRef.current;
          if (!commit) {
            advance({ kind: "error", errors: [] });
            return;
          }
          // commit.settingsPatch carries an extra `defaultDefectRate`
          // field that isn't part of RunSettings; cast through unknown
          // because the structural overlap is otherwise correct.
          const settings = mergeWithDefaults(
            commit.settingsPatch as unknown as Parameters<typeof mergeWithDefaults>[0],
          );
          const result = validateScenario(commit.nodes, commit.edges, settings);
          await sleep(phaseMs);
          if (cancelled) return;
          if (result.errors.length > 0) {
            advance({ kind: "error", errors: result.errors });
            return;
          }
          advance({ kind: "running", phaseIdx: 2 });
        } else if (phase.phaseIdx === 2) {
          // Phase 3 — Running first replication. The actual engine run
          // happens on the editor side via the autorun handoff; here we
          // perform the handoff write (real side-effect) so the editor
          // is ready to pick it up the moment the user clicks "Open
          // scenario" on the success screen.
          await sleep(phaseMs);
          if (cancelled) return;
          advance({ kind: "running", phaseIdx: 3 });
        } else if (phase.phaseIdx === 3) {
          // Phase 4 — Compiling KPIs. Final readiness check: confirm the
          // commit cache is populated before the success screen offers
          // the editor handoff.
          await sleep(phaseMs);
          if (cancelled) return;
          const commit = commitCacheRef.current;
          if (!commit) {
            advance({ kind: "error", errors: [] });
            return;
          }
          advance({ kind: "success", commit });
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unexpected error during commit.";
        advance({
          kind: "error",
          errors: [
            {
              code: "wizard-commit-failed",
              severity: "error",
              category: "schema",
              message,
            },
          ],
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, draft, phaseMs]);

  /** VROL-827 — success-screen CTA. Hands off the committed scenario via
   *  the existing `onFinish` path so the LandingPage / EditorPage wiring
   *  is unchanged. Mode = "run" so the autorun flag is set. */
  const onOpenScenario = useCallback(() => {
    onFinish(draft, "run");
    onClose();
  }, [draft, onFinish, onClose]);

  /** VROL-827 — error-screen jump. Returns to the offending step (or the
   *  review step as a fallback) and resets the phase back to authoring. */
  const onJumpFromError = useCallback((idx: number) => {
    setStepIdx(Math.max(0, Math.min(STEPS.length - 1, idx)));
    setAttemptedAdvance(true);
    setPhase({ kind: "authoring" });
    commitCacheRef.current = null;
  }, []);

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
   *
   * VROL-827 — also fires when the phase kind flips (e.g. running →
   * success) so the success-screen CTA receives focus immediately and
   * the user can press Enter to continue.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const root = bodyRef.current ?? dialog;
    const tabbables = getTabbable(root);
    const target = tabbables[0] ?? dialog;
    // Microtask defer so the new step DOM is wired up before we focus.
    queueMicrotask(() => {
      if (typeof target.focus === "function") {
        target.focus();
      }
    });
  }, [stepIdx, phase.kind]);

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
      // VROL-827 — Escape during the progress / success / error phase
      // just closes (the draft is already committed; saving over the
      // top would be confusing). Authoring phase keeps the Save & exit
      // semantics intact.
      if (phase.kind === "authoring") {
        onSaveAndExit();
      } else {
        onClose();
      }
      return;
    }
    // VROL-827 — arrow-key step navigation is only meaningful while the
    // user is authoring; suppress during running / success / error.
    if (phase.kind === "authoring") {
      if (e.key === "ArrowLeft") {
        goBack();
        return;
      }
      if (e.key === "ArrowRight" && !isLast && validation.valid) {
        goNext();
        return;
      }
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
        {phase.kind === "authoring" ? (
          <>
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
              onRun={startProgress}
            />
          </>
        ) : (
          <ProgressView
            phase={phase}
            titleId={titleId}
            onOpenScenario={onOpenScenario}
            onJumpFromError={onJumpFromError}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

/**
 * VROL-827 — replaces the 8-step body during the running / success /
 * error phases. Renders the 4-step indicator, a centered status line,
 * and a phase-specific CTA cluster.
 */
function ProgressView({
  phase,
  titleId,
  onOpenScenario,
  onJumpFromError,
  onClose,
}: {
  readonly phase: WizardPhase;
  readonly titleId: string;
  readonly onOpenScenario: () => void;
  readonly onJumpFromError: (idx: number) => void;
  readonly onClose: () => void;
}) {
  if (phase.kind === "authoring") return null;
  const phaseIdx =
    phase.kind === "running"
      ? phase.phaseIdx
      : phase.kind === "success"
        ? PROGRESS_PHASES.length
        : phase.kind === "error"
          ? 1 // we always fail after at most Validating
          : 0;
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-border border-b px-5 py-3">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
              {phase.kind === "running"
                ? "Creating scenario"
                : phase.kind === "success"
                  ? "Scenario ready"
                  : "Validation failed"}
            </div>
            <div id={titleId} className="font-heading text-base font-semibold">
              {phase.kind === "running"
                ? PROGRESS_PHASES[phase.phaseIdx]
                : phase.kind === "success"
                  ? "Your scenario is ready to open"
                  : "We couldn't validate your scenario"}
            </div>
          </div>
          {phase.kind !== "running" ? (
            <button
              type="button"
              aria-label="Close wizard"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground rounded"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <ProgressIndicator phaseIdx={phaseIdx} state={phase.kind} />
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        {phase.kind === "running" ? <RunningBody phaseIdx={phase.phaseIdx} /> : null}
        {phase.kind === "success" ? <SuccessBody onOpenScenario={onOpenScenario} /> : null}
        {phase.kind === "error" ? (
          <ErrorBody errors={phase.errors} onJump={onJumpFromError} onClose={onClose} />
        ) : null}
      </div>
    </div>
  );
}

function ProgressIndicator({
  phaseIdx,
  state,
}: {
  readonly phaseIdx: number;
  readonly state: "running" | "success" | "error" | "authoring";
}) {
  return (
    <ol
      className="mt-3 flex items-center gap-2"
      aria-label="Scenario creation progress"
      data-testid="wizard-progress-indicator"
    >
      {PROGRESS_PHASES.map((label, i) => {
        const isComplete = i < phaseIdx || state === "success";
        const isActive = state === "running" && i === phaseIdx;
        const isFailedAt = state === "error" && i === phaseIdx;
        return (
          <li
            key={label}
            className="flex flex-1 items-center gap-2"
            aria-current={isActive ? "step" : undefined}
            data-state={
              isComplete ? "complete" : isActive ? "active" : isFailedAt ? "failed" : "pending"
            }
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                isComplete
                  ? "bg-sim-running/20 text-sim-running"
                  : isActive
                    ? "bg-sim-running text-sim-running-foreground"
                    : isFailedAt
                      ? "bg-sim-down/20 text-sim-down"
                      : "bg-muted text-muted-foreground"
              }`}
            >
              {isComplete ? (
                <Check className="h-3 w-3" />
              ) : isActive ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : isFailedAt ? (
                <AlertTriangle className="h-3 w-3" />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={`hidden text-[11px] font-medium sm:inline ${
                isComplete || isActive ? "text-foreground" : "text-muted-foreground"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RunningBody({ phaseIdx }: { readonly phaseIdx: number }) {
  return (
    <div className="space-y-3 text-center">
      <Loader2 className="text-sim-running mx-auto h-8 w-8 animate-spin" aria-hidden />
      <div className="text-sm font-medium" role="status" aria-live="polite">
        {PROGRESS_PHASES[phaseIdx] ?? PROGRESS_PHASES[0]}…
      </div>
      <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
        We are committing the draft, validating the graph, and lining up the first replication.
      </p>
    </div>
  );
}

function SuccessBody({ onOpenScenario }: { readonly onOpenScenario: () => void }) {
  return (
    <div className="space-y-4 text-center">
      <div className="bg-sim-running/15 text-sim-running mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full">
        <CheckCircle2 className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <div className="font-heading text-base font-semibold">Scenario built</div>
        <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
          The graph is valid and the first replication is ready to fire. Open the scenario to view
          the live KPIs.
        </p>
      </div>
      <Button
        size="sm"
        onClick={onOpenScenario}
        className="gap-1.5"
        data-testid="wizard-open-scenario"
      >
        <ArrowRight className="h-3.5 w-3.5" />
        Open scenario
      </Button>
    </div>
  );
}

function ErrorBody({
  errors,
  onJump,
  onClose,
}: {
  readonly errors: readonly ValidationIssue[];
  readonly onJump: (idx: number) => void;
  readonly onClose: () => void;
}) {
  // Map each validation issue to the wizard step most likely to fix it.
  // The mapping is coarse (review-step = 7 fallback) so the user always
  // has a way back; the goal is to land near the offending field, not be
  // exact.
  function stepForIssue(issue: ValidationIssue): number {
    if (issue.path?.startsWith("edges")) return 2;
    if (issue.path?.startsWith("nodes")) return 1;
    if (issue.category === "topology") return 2;
    if (issue.category === "recipe") return 3;
    if (issue.category === "resource") return 4;
    if (issue.category === "schedule") return 6;
    return 7; // review
  }
  const fallbackStep = errors.length > 0 ? stepForIssue(errors[0]!) : 7;
  return (
    <div className="w-full max-w-md space-y-3">
      <div className="bg-sim-down/15 text-sim-down mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="text-muted-foreground text-center text-xs leading-relaxed">
        {errors.length === 0
          ? "Something went wrong while committing the draft. Jump back to the review step to inspect."
          : `${String(errors.length)} validation ${errors.length === 1 ? "issue" : "issues"} blocked the commit. Jump back to fix them.`}
      </p>
      {errors.length > 0 ? (
        <ul
          className="border-border bg-sim-down/5 max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs"
          data-testid="wizard-error-list"
        >
          {errors.slice(0, 5).map((e, i) => (
            <li key={`${e.code}-${String(i)}`} className="flex items-start gap-2">
              <AlertTriangle className="text-sim-down mt-0.5 h-3 w-3 shrink-0" />
              <div className="flex-1">
                <div className="text-foreground font-medium">{e.message}</div>
                {e.fix ? <div className="text-muted-foreground">{e.fix}</div> : null}
              </div>
              <button
                type="button"
                onClick={() => {
                  onJump(stepForIssue(e));
                }}
                className="text-sim-running shrink-0 underline-offset-2 hover:underline"
              >
                Jump
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button
          size="sm"
          onClick={() => {
            onJump(fallbackStep);
          }}
          className="gap-1"
          data-testid="wizard-jump-to-review"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to wizard
        </Button>
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
      return <StepConnections draft={draft} update={update} errors={errors} />;
    case 3:
      return <StepProducts draft={draft} update={update} errors={errors} />;
    case 4:
      return <StepRealism draft={draft} update={update} setRealism={setRealism} errors={errors} />;
    case 5:
      return <StepArrivals draft={draft} update={update} errors={errors} />;
    case 6:
      return <StepRunWindow draft={draft} update={update} errors={errors} />;
    case 7:
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
          Create scenario
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
