/**
 * VROL-405 / VROL-1134-1137 — NL result querying with simple RAG.
 *
 * Users ask plain-English questions about a finished run; the host
 * retrieves the most relevant facts from the ChainResult and sends
 * them to the LLM with a "answer ONLY from these facts" contract.
 * Network-free retrieval (TF-style keyword scoring); the LLM does
 * the synthesis.
 *
 * Design intent: no embeddings, no vector store. A single
 * ChainResult is small enough that we can shortlist via keyword
 * overlap and let the LLM pick. Embeddings can land later as a
 * pluggable scorer without touching the public surface.
 */

import type { ChainResult } from "@/engine";
import type { ChatAdapter, ChatOptions } from "./types";

/**
 * One retrievable fact about the run. `terms` is the keyword bag
 * used for scoring — populated at extraction time so retrieval is
 * pure scoring math.
 */
export interface ResultFact {
  readonly id: string;
  readonly kind: "kpi" | "bottleneck" | "station" | "sample" | "sustainability" | "constraint";
  readonly label: string;
  readonly value: string;
  readonly terms: readonly string[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "than",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "did",
  "do",
  "does",
  "much",
  "many",
  "any",
]);

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (!raw) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out;
}

/**
 * VROL-1134 — extract every fact that's worth indexing. Each fact is
 * already a final-answer snippet ("Line OEE was 75 %") so the LLM
 * stage is mostly choosing + paraphrasing rather than computing.
 */
export function extractResultFacts(result: ChainResult): readonly ResultFact[] {
  const facts: ResultFact[] = [];
  const labels = result.perStationLabels ?? [];

  // Line-level KPIs.
  const throughputPerHour = Math.round(result.throughputLambda * 3_600_000);
  facts.push({
    id: "kpi.throughput",
    kind: "kpi",
    label: "Line throughput",
    value: `${throughputPerHour.toLocaleString()} parts/h`,
    terms: ["throughput", "parts", "per", "hour", "rate", "speed", "output"],
  });
  facts.push({
    id: "kpi.oee",
    kind: "kpi",
    label: "Line OEE",
    value: `${(result.lineOee * 100).toFixed(0)} % (Availability × Performance × Quality)`,
    terms: ["oee", "efficiency", "availability", "performance", "quality"],
  });
  facts.push({
    id: "kpi.wip",
    kind: "kpi",
    label: "Average WIP",
    value: `${result.averageWipL.toFixed(1)} parts in inter-station buffers`,
    terms: ["wip", "work", "in", "process", "queue", "buffers"],
  });
  facts.push({
    id: "kpi.tis",
    kind: "kpi",
    label: "Average time in system",
    value: `${Math.round(result.avgTimeInSystemW).toLocaleString()} ms per part`,
    terms: ["time", "system", "tis", "latency", "duration", "ms"],
  });
  facts.push({
    id: "kpi.scrap",
    kind: "kpi",
    label: "Line scrap rate",
    value: `${(result.lineScrapRate * 100).toFixed(1)} % of total output`,
    terms: ["scrap", "defect", "defects", "waste", "quality"],
  });
  facts.push({
    id: "kpi.completed",
    kind: "kpi",
    label: "Parts completed",
    value: `${result.completed.toLocaleString()} parts`,
    terms: ["completed", "produced", "output", "count", "total"],
  });

  // Bottleneck.
  const top = result.bottlenecks[0];
  if (top) {
    facts.push({
      id: "bottleneck.top",
      kind: "bottleneck",
      label: "Bottleneck station",
      value: `${top.label} (${(top.runningPct * 100).toFixed(0)} % running, primary reason: ${top.primaryReason})`,
      terms: [
        "bottleneck",
        "constraint",
        "slowest",
        "binding",
        ...top.label.toLowerCase().split(/\s+/),
      ],
    });
  }

  // Per-station OEE snippets.
  result.perStationOee.forEach((oee, i) => {
    const label = labels[i] ?? `station-${String(i)}`;
    facts.push({
      id: `station.${String(i)}.oee`,
      kind: "station",
      label: `OEE for ${label}`,
      value: `Availability ${(oee.availability * 100).toFixed(0)} %, Performance ${(oee.performance * 100).toFixed(0)} %, Quality ${(oee.quality * 100).toFixed(0)} %`,
      terms: [
        "station",
        "oee",
        "availability",
        "performance",
        "quality",
        ...label.toLowerCase().split(/\s+/),
      ],
    });
  });

  // Per-station scrap counts.
  (result.perStationScrapped ?? []).forEach((count, i) => {
    if (count === 0) return;
    const label = labels[i] ?? `station-${String(i)}`;
    facts.push({
      id: `station.${String(i)}.scrap`,
      kind: "station",
      label: `Scrap at ${label}`,
      value: `${String(count)} parts scrapped`,
      terms: ["scrap", "defect", "defects", ...label.toLowerCase().split(/\s+/)],
    });
  });

  // Sustainability.
  if ((result.totalEnergyJ ?? 0) > 0) {
    const energyPerPart =
      result.completed > 0 ? Math.round(result.totalEnergyJ / result.completed) : 0;
    facts.push({
      id: "sustainability.energy",
      kind: "sustainability",
      label: "Energy consumption",
      value: `${Math.round(result.totalEnergyJ).toLocaleString()} J total, ${String(energyPerPart)} J per part`,
      terms: ["energy", "joules", "j", "power", "sustainability", "consumption"],
    });
  }
  if ((result.totalCO2eG ?? 0) > 0) {
    facts.push({
      id: "sustainability.co2",
      kind: "sustainability",
      label: "CO2e emissions",
      value: `${Math.round(result.totalCO2eG).toLocaleString()} g across the run`,
      terms: ["co2", "co2e", "carbon", "emissions", "footprint", "sustainability"],
    });
  }

  return facts;
}

/**
 * VROL-1135 — keyword-scored retrieval. Returns up to `maxFacts` of
 * the highest-scoring facts; ties broken by the original (extraction)
 * order so output is deterministic.
 */
export function retrieveRelevantFacts(
  question: string,
  facts: readonly ResultFact[],
  maxFacts = 8,
): readonly ResultFact[] {
  const qTokens = tokenize(question);
  if (qTokens.length === 0) return facts.slice(0, maxFacts);
  const scored = facts.map((fact, idx) => {
    const termSet = new Set(fact.terms);
    // Also include words from the label so the model gets a hit on
    // "what was the bottleneck" even if 'bottleneck' is in `terms`
    // but the label has e.g. "Filler".
    for (const t of tokenize(fact.label)) termSet.add(t);
    let score = 0;
    for (const q of qTokens) {
      if (termSet.has(q)) score += 1;
    }
    return { fact, idx, score };
  });
  // Always include KPI facts as a baseline so questions like
  // "how was the run?" get a useful answer when keywords don't overlap.
  return scored
    .map(({ fact, idx, score }) => ({
      fact,
      idx,
      // Tiny floor for KPI facts so they're a backstop when there's
      // no other signal, but real keyword hits still rank above them.
      effective: score > 0 ? score : fact.kind === "kpi" ? 0.1 : 0,
    }))
    .filter((s) => s.effective > 0)
    .sort((a, b) => b.effective - a.effective || a.idx - b.idx)
    .slice(0, maxFacts)
    .map((s) => s.fact);
}

/**
 * VROL-1136 — locked-in answer contract. Stick to facts; "I don't
 * know" beats hallucinating.
 */
export function queryResultSystemPrompt(): string {
  return `You answer questions about a single completed Vrolen simulation run. The user shows you a list of FACTS retrieved from the run and a QUESTION. Reply with a 1-3 sentence answer that uses ONLY the facts.

Rules:
1. If the answer isn't in the facts, reply exactly: "I don't have that in this run's data."
2. Quote numbers verbatim from the facts; don't round further.
3. No marketing copy, no headers, no markdown.
4. If multiple facts contribute, weave them into one short answer; don't list bullets.`;
}

interface QueryOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxFacts?: number;
}

/** Discriminated result so the host can handle empty-fact cases cleanly. */
export type QueryResult =
  | {
      readonly ok: true;
      readonly answer: string;
      readonly facts: readonly ResultFact[];
      readonly source: "llm" | "fallback";
    }
  | { readonly ok: false; readonly reason: "no-question" | "no-facts" };

/**
 * VROL-1137 — top-level entry. Extract → retrieve → prompt → return.
 * Adapter errors and empty responses both fall back to a deterministic
 * "I don't know" so the UI surface never goes blank.
 */
export async function queryRunResult(
  adapter: ChatAdapter,
  result: ChainResult,
  question: string,
  opts: QueryOptions = {},
): Promise<QueryResult> {
  const trimmed = question.trim();
  if (trimmed.length === 0) return { ok: false, reason: "no-question" };
  const facts = extractResultFacts(result);
  const relevant = retrieveRelevantFacts(trimmed, facts, opts.maxFacts ?? 8);
  if (relevant.length === 0) return { ok: false, reason: "no-facts" };
  const factsBlock = relevant.map((f) => `- ${f.label}: ${f.value}`).join("\n");
  const userContent = `Facts retrieved from the run:\n${factsBlock}\n\nQuestion: ${trimmed}`;
  const chatOptions: ChatOptions = {
    model: opts.model ?? "gemini-flash",
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    systemPrompt: queryResultSystemPrompt(),
  };
  try {
    const response = await adapter.chat([{ role: "user", content: userContent }], chatOptions);
    const answer = response.text.trim();
    if (answer.length > 0) {
      return { ok: true, answer, facts: relevant, source: "llm" };
    }
  } catch {
    // Adapter error → deterministic fallback.
  }
  return {
    ok: true,
    answer: "I don't have that in this run's data.",
    facts: relevant,
    source: "fallback",
  };
}
