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
import { generateScenarioFromNl, type ScenarioGenerationResult } from "@/ai/scenario-tool";
import type { GeneratedScenario } from "@/ai/scenario-schema";
import { createSharedOpenAiAdapter, sharedOpenAiAvailable } from "@/ai/shared-openai";

import { aiScenarioToGraph, type AiScenarioGraph } from "@/lib/scenario-from-ai";

const EXAMPLE_PROMPTS: readonly { readonly title: string; readonly body: string }[] = [
  {
    title: "Bottling line with rework",
    body: "A bottling line with two parallel fillers, each 5s per bottle, feeding a capper that takes 3s. A QC station after the capper rejects 8% of bottles back to the capper for rework. Labeler and packer at the end.",
  },
  {
    title: "Bakery dough → oven → cooling",
    body: "Bakery line: mixer (90s), divider (15s), proofer (40min), oven (35min, capacity 4 batches in parallel), cooling rack (20min), packer (10s).",
  },
  {
    title: "Electronics SMT line",
    body: "SMT pick-and-place line: solder paste printer (10s), SMT placement (12s, 2 in parallel), reflow oven (90s), AOI inspection (15s, 3% defect), test (20s).",
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
      readonly kind: "success";
      readonly scenario: GeneratedScenario;
      readonly graph: AiScenarioGraph;
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

  const runGenerate = async () => {
    setStatus({ kind: "running" });
    const trimmedKey = apiKey.trim();
    const providerKey: ProviderKey = {
      providerId,
      apiKey: trimmedKey,
      addedAt: 0, // overwritten by store on persist; not used by the adapter
    };
    if (keySource === "byo" && rememberKey) {
      try {
        // Refresh addedAt so the dashboard can sort by last-used later.
        store.upsert({ ...providerKey, addedAt: 0 });
      } catch {
        // private mode / quota — ignore, generation still works
      }
    }
    try {
      const result =
        generate !== undefined
          ? await generate(providerKey, prompt.trim())
          : keySource === "shared"
            ? await generateScenarioFromNl(createSharedOpenAiAdapter(), prompt.trim(), {
                model: "gpt-4o-mini",
              })
            : await generateScenarioFromNl(createAdapterForProvider(providerKey), prompt.trim());
      if (!result.ok) {
        setStatus({
          kind: "error",
          message: `Generation failed after ${String(result.attempts)} attempt${result.attempts === 1 ? "" : "s"}: ${result.lastError}`,
        });
        return;
      }
      const graph = aiScenarioToGraph(result.scenario);
      setStatus({ kind: "success", scenario: result.scenario, graph });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStatus({ kind: "error", message: msg });
    }
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
        className="flex w-[28rem] flex-col gap-0 overflow-y-auto sm:max-w-md"
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
              <Button onClick={handleApply} data-testid="describe-factory-apply" className="w-full">
                Replace canvas with this scenario
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
