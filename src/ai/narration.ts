/**
 * VROL-410 / VROL-1126-1128 — auto-narration of a sim run.
 *
 * Two-stage pipeline:
 *
 * 1. `deriveDeterministicNarration(result)` — pure function over
 *    ChainResult; extracts the salient facts (bottleneck, OEE story,
 *    scrap, sustainability, top action card rule). Returns a typed
 *    NarrationBundle the LLM polish step can consume.
 *
 * 2. `narrateRun(adapter, result, opts)` — sends the bundle to the
 *    LLM via the abstraction (S186) for a 2-3 sentence plain-English
 *    polish. Falls back to a deterministic template when the adapter
 *    returns empty / errors so the result panel never goes blank.
 *
 * Designed so the result-panel UI can call `narrateRun()` once per
 * run and bind the returned string to a "Narration" tile.
 */

import type { ChainResult } from "@/engine";
import type { ChatAdapter, ChatOptions } from "./types";
import { deriveActionCard, type ActionCard } from "@/lib/derive-action-card";

/**
 * The salient facts about a single run, picked so the LLM (or the
 * fallback template) has everything it needs to write a 2-3 sentence
 * summary without making up numbers.
 */
export interface NarrationBundle {
  readonly throughputPerHour: number;
  readonly lineOee: number;
  readonly lineScrapRate: number;
  readonly avgTimeInSystemMs: number;
  readonly averageWipL: number;
  readonly bottleneckLabel: string | null;
  readonly bottleneckReason: string | null;
  /** "Availability" | "Performance" | "Quality" — slimmest factor at the bottleneck. */
  readonly slimOeeFactor: "availability" | "performance" | "quality" | null;
  /** Title of the top action card rule (or null if not derivable). */
  readonly topActionCardTitle: string | null;
  /**
   * Sustainability footprint when stations declared inputs; null
   * when no sustainability data is present.
   */
  readonly sustainability: {
    readonly totalEnergyJ: number;
    readonly energyPerPartJ: number;
  } | null;
}

/**
 * VROL-1126 — extract the bundle from a ChainResult. Pure function;
 * no engine work, no allocation hot path concerns.
 */
export function deriveDeterministicNarration(result: ChainResult): NarrationBundle {
  const top = result.bottlenecks[0] ?? null;
  const bottleneckIdx = result.bottleneckStationIdx;
  const oee = result.perStationOee[bottleneckIdx];
  let slim: NarrationBundle["slimOeeFactor"] = null;
  if (oee) {
    const min = Math.min(oee.availability, oee.performance, oee.quality);
    slim =
      min === oee.availability
        ? "availability"
        : min === oee.performance
          ? "performance"
          : "quality";
  }
  let actionCardTitle: string | null = null;
  try {
    const card: ActionCard | null = deriveActionCard(result);
    actionCardTitle = card?.title ?? null;
  } catch {
    // Action card derivation can throw on malformed fixtures during
    // tests — swallow so the bundle still gets built.
  }
  const totalEnergyJ = result.totalEnergyJ ?? 0;
  const sustainability =
    totalEnergyJ > 0
      ? {
          totalEnergyJ,
          energyPerPartJ: result.completed > 0 ? totalEnergyJ / result.completed : 0,
        }
      : null;
  return {
    throughputPerHour: Math.round(result.throughputLambda * 3_600_000),
    lineOee: result.lineOee,
    lineScrapRate: result.lineScrapRate,
    avgTimeInSystemMs: result.avgTimeInSystemW,
    averageWipL: result.averageWipL,
    bottleneckLabel: top?.label ?? null,
    bottleneckReason: top?.primaryReason ?? null,
    slimOeeFactor: slim,
    topActionCardTitle: actionCardTitle,
    sustainability,
  };
}

/**
 * VROL-1127 — system prompt for the LLM polish step. Stable + short:
 * the contract is "stick to the bundle, no new facts."
 */
export function narrationSystemPrompt(): string {
  return `You are Vrolen's run-narrator. The user shows you a NarrationBundle (key facts from one simulation run) and you reply with 2-3 sentences in plain English for an operations engineer.

Rules:
1. Use ONLY the facts from the bundle. Never invent numbers, station names, or causes.
2. Round numbers to readable values (e.g. "around 750/h", "53% line OEE").
3. Lead with the most informative fact (usually throughput vs the bottleneck story).
4. Match the engineer's voice — direct, no marketing copy, no "Awesome!"

Reply with only the narration text. No JSON, no markdown.`;
}

/**
 * Result of a narrate call. Includes the source bundle so callers
 * can display structured facts alongside the prose if they want.
 */
export interface NarrationResult {
  readonly bundle: NarrationBundle;
  readonly text: string;
  /** Where the text came from: "llm" | "fallback". */
  readonly source: "llm" | "fallback";
}

interface NarrateOptions {
  readonly model?: string;
  readonly temperature?: number;
}

/**
 * VROL-1128 — top-level narrate function. Derives the bundle,
 * asks the LLM to polish it, falls back to a deterministic template
 * when the LLM is unavailable or returns empty text.
 */
export async function narrateRun(
  adapter: ChatAdapter,
  result: ChainResult,
  opts: NarrateOptions = {},
): Promise<NarrationResult> {
  const bundle = deriveDeterministicNarration(result);
  const chatOptions: ChatOptions = {
    model: opts.model ?? "gemini-flash",
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    systemPrompt: narrationSystemPrompt(),
  };
  try {
    const response = await adapter.chat(
      [{ role: "user", content: JSON.stringify(bundle, null, 2) }],
      chatOptions,
    );
    const text = response.text.trim();
    if (text.length > 0) {
      return { bundle, text, source: "llm" };
    }
  } catch {
    // Adapter error → fall through to deterministic template.
  }
  return { bundle, text: deterministicNarrationTemplate(bundle), source: "fallback" };
}

/**
 * Deterministic template — what users see when the LLM is unavailable.
 * Plain English; reads naturally without polish but doesn't pretend
 * to be AI-generated.
 */
function deterministicNarrationTemplate(b: NarrationBundle): string {
  const parts: string[] = [];
  parts.push(
    `Line ran at ${b.throughputPerHour.toLocaleString()} parts/h with ${(b.lineOee * 100).toFixed(0)}% OEE`,
  );
  if (b.bottleneckLabel) {
    const reasonText = b.bottleneckReason ? ` (${b.bottleneckReason})` : "";
    parts.push(`bottleneck at ${b.bottleneckLabel}${reasonText}`);
  }
  if (b.slimOeeFactor && b.bottleneckLabel) {
    parts.push(`${b.slimOeeFactor} is the slim factor`);
  }
  if (b.lineScrapRate > 0.01) {
    parts.push(`scrap ${(b.lineScrapRate * 100).toFixed(1)}%`);
  }
  if (b.sustainability) {
    parts.push(`${Math.round(b.sustainability.energyPerPartJ)} J/part`);
  }
  let primary = parts.join(", ") + ".";
  if (b.topActionCardTitle) {
    primary += ` Next step: ${b.topActionCardTitle}.`;
  }
  return primary;
}
