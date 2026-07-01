/**
 * VROL-402 (Sprint 196) — "Describe your factory" prompt UI.
 *
 * Wraps the existing `generateScenarioFromNl` adapter so the user can
 * paste a free-form description of a production line ("two parallel
 * fillers feeding a slow capper, with a QC station that reworks 15%
 * back to the capper") and get a runnable scenario back.
 *
 * BYO key path only — no Supabase proxy yet (VROL-393 is infra-blocked
 * and stays deferred). Provider + API key are persisted to the same
 * localStorage store the future settings UI will share so this isn't
 * throw-away wiring.
 */

import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createAdapterForProvider } from "@/ai/adapter-factory";
import {
  PROVIDER_CATALOGUE,
  createLocalStorageProviderKeyStore,
  listProviders,
  type ProviderId,
  type ProviderKey,
  type ProviderKeyStore,
} from "@/ai/provider-keys";
import {
  generateScenarioFromNl,
  type PriorClarificationContext,
  type ScenarioGenerationResult,
} from "@/ai/scenario-tool";
import type { GeneratedScenario } from "@/ai/scenario-schema";
import type { ClarificationAnswer, ClarificationQuestion } from "@/ai/clarification-schema";
import { createSharedOpenAiAdapter, sharedOpenAiAvailable } from "@/ai/shared-openai";

import { aiScenarioToGraph, type AiScenarioGraph } from "@/lib/scenario-from-ai";
import { validateScenario, type ValidationIssue } from "@/lib/validate-scenario";

const EXAMPLE_PROMPTS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: "Bottling line with QC",
    body: "A bottling line: one shared input, two parallel fillers (each 5s per bottle) feeding a single capper (3s), then QC with 8% defect rate, then labeler (2s), then packer (4s).",
  },
  {
    title: "Bakery dough → oven → cooling",
    body: "Bakery line: mixer (90s), divider (15s), proofer (40min), oven (35min, capacity 4 batches in parallel), cooling rack (20min), packer (10s).",
  },
  {
    title: "Electronics SMT line",
    body: "SMT pick-and-place line: solder paste printer (10s), SMT placement (12s, capacity 2), reflow oven (90s), AOI inspection (15s, 3% defect), test (20s).",
  },
];

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Called when the user clicks Apply. Receives the converted react-flow
   * graph + RunSettings ready to swap into the editor canvas.
   */
  readonly onApply: (graph: AiScenarioGraph, originalPrompt: string) => void;
  /** Override the store in tests. */
  readonly keyStore?: ProviderKeyStore;
  /** Override the adapter factory in tests. */
  readonly generate?: (
    providerKey: ProviderKey,
    prompt: string,
  ) => Promise<ScenarioGenerationResult>;
}

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | {
      readonly kind: "error";
      readonly message: string;
    }
  | {
      readonly kind: "questions";
      readonly questions: readonly ClarificationQuestion[];
      readonly priorContext: PriorClarificationContext;
    }
  | {
      readonly kind: "success";
      readonly scenario: GeneratedScenario;
      readonly graph: AiScenarioGraph;
      /** VROL-1210 — post-schema engine checks (single-source, cycles, …). */
      readonly engineErrors: readonly ValidationIssue[];
      readonly engineWarnings: readonly ValidationIssue[];
    };

export function DescribeFactorySheet({
  open,
  onOpenChange,
  onApply,
  keyStore,
  generate,
}: Props): ReactElement {
  const store = useMemo(() => keyStore ?? createLocalStorageProviderKeyStore(), [keyStore]);
  const sharedAvailable = sharedOpenAiAvailable();
  // Preselect the shared key mode when available so a new user gets a
  // zero-friction AI experience; BYO stays a click away.
  const [keySource, setKeySource] = useState<"shared" | "byo">(sharedAvailable ? "shared" : "byo");
  const [providerId, setProviderId] = useState<ProviderId>("openai");
  const [apiKey, setApiKey] = useState<string>("");
  const [prompt, setPrompt] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rememberKey, setRememberKey] = useState<boolean>(true);

  // VROL-402 — rehydrate the stored key when the sheet opens or the
  // user picks a different provider. Syncing from an external store
  // (localStorage) is exactly the cross-system sync useEffect exists
  // for; the lint rule's set-state-in-effect warning is a false
  // positive here.
  useEffect(() => {
    if (!open) return;
    const stored = store.get(providerId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setApiKey(stored?.apiKey ?? "");
  }, [open, providerId, store]);

  const canGenerate =
    (keySource === "shared" || apiKey.trim().length > 0) &&
    prompt.trim().length > 0 &&
    status.kind !== "running";

  const runGenerate = async (
    opts: {
      priorContext?: PriorClarificationContext;
      skipClarification?: boolean;
    } = {},
  ) => {
    setStatus({ kind: "running" });
    const trimmedKey = apiKey.trim();
    const providerKey: ProviderKey = {
      providerId,
      apiKey: trimmedKey,
      addedAt: 0, // overwritten by store on persist; not used by the adapter
    };
    if (keySource === "byo" && rememberKey) {
      try {
        store.upsert({ ...providerKey, addedAt: 0 });
      } catch {
        // private mode / quota — ignore, generation still works
      }
    }
    try {
      // Test-only injected `generate` predates the clarification flow;
      // it always returns a scenario or an error, never questions.
      const result =
        generate !== undefined
          ? await generate(providerKey, prompt.trim())
          : keySource === "shared"
            ? await generateScenarioFromNl(createSharedOpenAiAdapter(), prompt.trim(), {
                model: "gpt-4o-mini",
                ...(opts.priorContext ? { priorContext: opts.priorContext } : {}),
                ...(opts.skipClarification ? { skipClarification: true } : {}),
              })
            : await generateScenarioFromNl(createAdapterForProvider(providerKey), prompt.trim(), {
                ...(opts.priorContext ? { priorContext: opts.priorContext } : {}),
                ...(opts.skipClarification ? { skipClarification: true } : {}),
              });
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: `Generation failed after ${String(result.attempts)} attempt${result.attempts === 1 ? "" : "s"}: ${result.lastError}`,
        });
        return;
      }
      // VROL-1211 — LLM asked for clarification instead of emitting.
      if ("needsClarification" in result && result.needsClarification) {
        setStatus({
          kind: "questions",
          questions: result.questions,
          priorContext: {
            conversation: result.conversation,
            questions: result.questions,
          },
        });
        return;
      }
      const graph = aiScenarioToGraph(result.scenario);
      // VROL-1210 — belt-and-suspenders engine validation on the
      // converted graph. Blocks Apply if a topology error snuck through.
      const validation = validateScenario(graph.nodes, graph.edges, graph.settings);
      setStatus({
        kind: "success",
        scenario: result.scenario,
        graph,
        engineErrors: validation.errors,
        engineWarnings: validation.warnings,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message: msg });
    }
  };

  // VROL-1211 — user submits their answers or skips.
  const submitAnswers = (answers: readonly ClarificationAnswer[]) => {
    if (status.kind !== "questions") return;
    void runGenerate({
      priorContext: { ...status.priorContext, answers },
    });
  };
  const skipClarification = () => {
    if (status.kind !== "questions") return;
    void runGenerate({
      priorContext: status.priorContext,
      skipClarification: true,
    });
  };

  const handleApply = () => {
    if (status.kind !== "success") return;
    onApply(status.graph, prompt.trim());
    setStatus({ kind: "idle" });
    onOpenChange(false);
  };

  const handleClearKey = () => {
    store.remove(providerId);
    setApiKey("");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // VROL-1197 — z-[70] beats the default z-50 (backdrop, tooltips,
        // toasts) and the wizard's z-[60]. Under the audit's original
        // z-50 the sheet stacked BEHIND editor toolbars in some routes.
        className="z-[70] flex w-[28rem] flex-col gap-0 overflow-y-auto sm:max-w-md"
        overlayClassName="z-[65]"
        data-testid="describe-factory-sheet"
      >
        <SheetHeader className="space-y-1 pr-10">
          <SheetTitle className="font-heading flex items-center gap-2">
            <Sparkles className="h-4 w-4" aria-hidden /> Describe your factory
          </SheetTitle>
          <SheetDescription>
            Type a free-form description; the AI returns a runnable scenario.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 p-4">
          {sharedAvailable ? (
            <div
              className="border-border bg-muted/30 space-y-2 rounded-md border p-3"
              data-testid="describe-factory-key-source"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium tracking-wide uppercase">Key</span>
                <div className="border-border bg-card inline-flex items-center gap-0.5 rounded-md border p-0.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => {
                      setKeySource("shared");
                    }}
                    aria-pressed={keySource === "shared"}
                    data-testid="describe-factory-key-source-shared"
                    className={`rounded-sm px-2 py-0.5 font-medium transition-colors ${
                      keySource === "shared"
                        ? "bg-sim-running/15 text-sim-running"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Use Vrolen's
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setKeySource("byo");
                    }}
                    aria-pressed={keySource === "byo"}
                    data-testid="describe-factory-key-source-byo"
                    className={`rounded-sm px-2 py-0.5 font-medium transition-colors ${
                      keySource === "byo"
                        ? "bg-sim-running/15 text-sim-running"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Bring your own
                  </button>
                </div>
              </div>
              <p className="text-muted-foreground text-[11px] leading-snug">
                {keySource === "shared"
                  ? "Runs through Vrolen's OpenAI key — no signup needed."
                  : "Paste your own OpenAI, Anthropic, OpenRouter, Gemini, or Cloudflare key. Stored locally, not encrypted."}
              </p>
            </div>
          ) : null}
          {keySource === "byo" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium tracking-wide uppercase" htmlFor="dfs-provider">
                Provider
              </label>
              <Select
                value={providerId}
                onValueChange={(v) => {
                  setProviderId(v as ProviderId);
                }}
              >
                <SelectTrigger id="dfs-provider" data-testid="describe-factory-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {listProviders().map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Default model: <code>{PROVIDER_CATALOGUE[providerId].defaultModel}</code>
              </p>
            </div>
          ) : null}
          {keySource === "byo" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium tracking-wide uppercase" htmlFor="dfs-key">
                API key
              </label>
              <div className="flex gap-2">
                <Input
                  id="dfs-key"
                  type="password"
                  value={apiKey}
                  placeholder="sk-…"
                  onChange={(e) => {
                    setApiKey(e.target.value);
                  }}
                  data-testid="describe-factory-key"
                  autoComplete="off"
                  className="flex-1 font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearKey}
                  disabled={apiKey.length === 0}
                  aria-label="Remove stored key"
                  title="Remove stored key"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
              <label className="text-muted-foreground flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={rememberKey}
                  onChange={(e) => {
                    setRememberKey(e.target.checked);
                  }}
                  data-testid="describe-factory-remember"
                />
                Remember on this device (localStorage, not encrypted)
              </label>
            </div>
          ) : null}
          <div className="space-y-2">
            <label className="text-xs font-medium tracking-wide uppercase" htmlFor="dfs-prompt">
              Describe the line
            </label>
            <textarea
              id="dfs-prompt"
              value={prompt}
              placeholder="A bottling line with two parallel fillers…"
              onChange={(e) => {
                setPrompt(e.target.value);
              }}
              data-testid="describe-factory-prompt"
              rows={6}
              className="border-border bg-card focus-visible:ring-ring w-full resize-y rounded-md border p-2 font-mono text-xs outline-none focus-visible:ring-2"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((ex) => (
                <button
                  key={ex.title}
                  type="button"
                  onClick={() => {
                    setPrompt(ex.body);
                  }}
                  className="border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground rounded-full border px-2.5 py-0.5 text-[11px]"
                  data-testid={`describe-factory-example-${ex.title.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {ex.title}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => {
                void runGenerate();
              }}
              disabled={!canGenerate}
              data-testid="describe-factory-generate"
              className="flex-1"
            >
              {status.kind === "running" ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" aria-hidden /> Generate scenario
                </>
              )}
            </Button>
          </div>
          {status.kind === "error" ? (
            <div
              className="border-sim-down/40 bg-sim-down/5 text-sim-down-foreground rounded-md border p-3 text-xs"
              data-testid="describe-factory-error"
            >
              {status.message}
            </div>
          ) : null}
          {status.kind === "questions" ? (
            <QuestionsPanel
              questions={status.questions}
              onSubmit={submitAnswers}
              onSkip={skipClarification}
            />
          ) : null}
          {status.kind === "success" ? (
            <div
              className="border-sim-running/40 bg-sim-running/5 space-y-2 rounded-md border p-3 text-xs"
              data-testid="describe-factory-preview"
            >
              <div className="flex items-baseline justify-between">
                <strong className="text-foreground text-sm">Preview</strong>
                <span className="text-muted-foreground tabular-nums">
                  {status.scenario.stations.length} stations · {status.scenario.edges.length} edges
                </span>
              </div>
              <ul className="space-y-0.5">
                {status.scenario.stations.map((s) => (
                  <li key={s.id} className="font-mono">
                    <span className="text-foreground">{s.label}</span>
                    <span className="text-muted-foreground"> — {s.cycleMs} ms cycle</span>
                    {s.capacity !== undefined && s.capacity > 1 ? (
                      <span className="text-muted-foreground"> · ×{s.capacity}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Horizon {Math.round(status.scenario.settings.horizonMs / 1000)} s · replications{" "}
                {status.scenario.settings.replications}
              </p>
              {status.engineErrors.length > 0 ? (
                <div
                  className="border-sim-down/40 bg-sim-down/5 text-sim-down-foreground space-y-1 rounded-md border p-2 text-[11px]"
                  data-testid="describe-factory-engine-errors"
                  role="alert"
                >
                  <strong className="text-foreground text-xs">
                    {status.engineErrors.length} topology issue
                    {status.engineErrors.length === 1 ? "" : "s"} — needs a regen
                  </strong>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {status.engineErrors.slice(0, 4).map((e, i) => (
                      <li key={`${e.code}-${String(i)}`}>{e.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {status.engineWarnings.length > 0 ? (
                <div
                  className="border-sim-setup/40 bg-sim-setup/5 text-muted-foreground space-y-1 rounded-md border p-2 text-[11px]"
                  data-testid="describe-factory-engine-warnings"
                >
                  <strong className="text-foreground text-xs">
                    {status.engineWarnings.length} warning
                    {status.engineWarnings.length === 1 ? "" : "s"}
                  </strong>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {status.engineWarnings.slice(0, 3).map((w, i) => (
                      <li key={`${w.code}-${String(i)}`}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Button
                onClick={handleApply}
                disabled={status.engineErrors.length > 0}
                data-testid="describe-factory-apply"
                className="w-full"
              >
                {status.engineErrors.length > 0
                  ? "Fix errors before applying"
                  : "Replace canvas with this scenario"}
              </Button>
              <p className="text-muted-foreground text-[10px]">
                This wipes the current canvas. Save it first if you want to keep it.
              </p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * VROL-1211 — inline form the LLM's questions render into. One text
 * input per question, prefilled with suggestedAnswer when the model
 * provided one. Two buttons: "Answer & continue" submits back to the
 * LLM; "Continue anyway" tells the LLM to use defaults.
 */
function QuestionsPanel({
  questions,
  onSubmit,
  onSkip,
}: {
  readonly questions: readonly ClarificationQuestion[];
  readonly onSubmit: (answers: readonly ClarificationAnswer[]) => void;
  readonly onSkip: () => void;
}): ReactElement {
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const q of questions) out[q.id] = q.suggestedAnswer ?? "";
    return out;
  });
  const anyAnswered = Object.values(drafts).some((v) => v.trim().length > 0);
  return (
    <div
      className="border-sim-setup/40 bg-sim-setup/5 space-y-3 rounded-md border p-3 text-xs"
      data-testid="describe-factory-questions"
      role="region"
      aria-label="Clarification questions"
    >
      <div className="space-y-1">
        <strong className="text-foreground text-sm">A few quick questions</strong>
        <p className="text-muted-foreground text-[11px] leading-snug">
          Answering makes the scenario match your line more precisely. Or skip and I&apos;ll pick
          sensible defaults.
        </p>
        {/* VROL-1221 — a shared helper reminding users that human units
            are welcome. The system prompt (v4) also tells the LLM to
            phrase questions in seconds / minutes, but users still see
            legacy runs so we surface the reassurance here regardless. */}
        <p className="text-muted-foreground text-[10px] leading-snug">
          Times can be written however you like — <span className="font-mono">2 s</span>,{" "}
          <span className="font-mono">1.5 min</span>, <span className="font-mono">8 h</span>, or a
          plain number.
        </p>
      </div>
      <div className="space-y-2.5">
        {questions.map((q, i) => (
          <div key={q.id} className="space-y-1">
            <label htmlFor={`dfs-q-${q.id}`} className="text-foreground text-xs font-medium">
              {String(i + 1)}. {q.question}
            </label>
            <Input
              id={`dfs-q-${q.id}`}
              type="text"
              value={drafts[q.id] ?? ""}
              placeholder={q.hint ?? ""}
              onChange={(e) => {
                setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }));
              }}
              data-testid={`describe-factory-question-${q.id}`}
              className="h-8 text-xs"
              autoComplete="off"
            />
            {q.hint ? <p className="text-muted-foreground text-[10px]">{q.hint}</p> : null}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            const answers: ClarificationAnswer[] = questions.map((q) => ({
              id: q.id,
              answer: drafts[q.id] ?? "",
            }));
            onSubmit(answers);
          }}
          disabled={!anyAnswered}
          data-testid="describe-factory-questions-submit"
          className="flex-1"
        >
          Answer &amp; continue
        </Button>
        <Button variant="outline" onClick={onSkip} data-testid="describe-factory-questions-skip">
          Continue anyway
        </Button>
      </div>
    </div>
  );
}
