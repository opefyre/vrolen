/**
 * VROL-1211 — Zod schema for AI clarification questions.
 *
 * When the user's prompt is missing critical detail (station cycle
 * times, capacity for parallel stations, defect rates, horizon length)
 * the LLM emits `ask_clarification` instead of `emit_scenario`. The
 * host renders the questions as a small inline form; the user can
 * answer or click "Continue anyway" to accept defaults.
 *
 * Questions are always answered as free-form strings. The LLM can
 * hint a suggestion + an example to make answering feel low-effort.
 */

import { z } from "zod";

const MAX_QUESTIONS = 5;
const MAX_QUESTION_TEXT = 240;
const MAX_HINT_TEXT = 160;

const questionSchema = z.object({
  /** Stable id so answers can be reassembled across renders. */
  id: z.string().min(1).max(60),
  /** Human-readable question ("How long does each capper cycle take?"). */
  question: z.string().min(1).max(MAX_QUESTION_TEXT),
  /** Optional hint / example ("e.g., 2s per bottle"). */
  hint: z.string().max(MAX_HINT_TEXT).optional(),
  /** Optional pre-filled suggested answer the user can accept as-is. */
  suggestedAnswer: z.string().max(MAX_HINT_TEXT).optional(),
});

export const clarificationSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1, "At least one clarification question is required.")
    .max(MAX_QUESTIONS, `At most ${String(MAX_QUESTIONS)} questions per round.`),
});

export type ClarificationQuestion = z.infer<typeof questionSchema>;
export type Clarification = z.infer<typeof clarificationSchema>;

/** A user's answer bundle, in the shape the host feeds back to the LLM. */
export interface ClarificationAnswer {
  readonly id: string;
  readonly answer: string;
}
