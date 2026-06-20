/**
 * VROL-82 — Recipe + CustomKpi expression types.
 *
 * Recipe: maps {materialId → unitsPerPart} so the engine can deduct
 * material pool levels as parts complete. Mirrors the recipe shape the
 * UI already produces but factors the type out of the inspector module.
 *
 * CustomKpi: small whitelisted arithmetic over named bindings (so a user
 * can define e.g. "yield = good / total" or "labor_eff = oee /
 * laborUtil"). Evaluator only supports +, -, *, /, parentheses, numeric
 * literals, and identifiers — no function calls, no property access, no
 * comparison. That keeps the surface tiny + safe to evaluate
 * client-side without an AST sandbox.
 */

import { z } from "zod";

export const RecipeSchema = z
  .object({
    /** Map of material id → units required per finished part. */
    perPart: z.record(z.string(), z.number().nonnegative()),
  })
  .strict();

export type Recipe = z.infer<typeof RecipeSchema>;

export const CustomKpiSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Arithmetic expression over the available bindings. */
    expression: z.string().min(1),
    /** Optional unit suffix shown next to the value. */
    unit: z.string().optional(),
    /** Optional number-of-fraction-digits hint for the display. */
    digits: z.number().int().min(0).max(6).optional(),
  })
  .strict();

export type CustomKpi = z.infer<typeof CustomKpiSchema>;

/**
 * Evaluate an arithmetic expression over a binding map. Returns NaN if
 * the expression is malformed or references an unknown binding. Whitelist
 * by tokenising — the only inputs we accept are numeric literals,
 * identifiers from the binding set, the four operators, and parentheses.
 */
export function evaluateCustomKpi(
  expression: string,
  bindings: Readonly<Record<string, number>>,
): number {
  const tokens: string[] = [];
  let i = 0;
  while (i < expression.length) {
    const c = expression[i];
    if (c === undefined) break;
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if ("()+-*/".includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    // Number literal (allow decimal but no exponent — we don't need it).
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < expression.length && /[0-9.]/.test(expression[j] ?? "")) j++;
      tokens.push(expression.slice(i, j));
      i = j;
      continue;
    }
    // Identifier ([A-Za-z_][A-Za-z0-9_]*).
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < expression.length && /[A-Za-z0-9_]/.test(expression[j] ?? "")) j++;
      tokens.push(expression.slice(i, j));
      i = j;
      continue;
    }
    return NaN;
  }
  // Replace identifiers with their numeric binding; bail if unknown.
  const resolved: (string | number)[] = [];
  for (const t of tokens) {
    if (/^[A-Za-z_]/.test(t)) {
      if (!(t in bindings)) return NaN;
      resolved.push(bindings[t] ?? NaN);
    } else if (/^[0-9.]+$/.test(t)) {
      const n = Number(t);
      if (!Number.isFinite(n)) return NaN;
      resolved.push(n);
    } else {
      resolved.push(t);
    }
  }
  // Shunting-yard → RPN → evaluate. Precedence: */ over +-.
  const prec: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };
  const out: (string | number)[] = [];
  const ops: string[] = [];
  for (const t of resolved) {
    if (typeof t === "number") {
      out.push(t);
    } else if (t === "(") {
      ops.push(t);
    } else if (t === ")") {
      while (ops.length > 0 && ops[ops.length - 1] !== "(") {
        out.push(ops.pop() ?? "");
      }
      if (ops.pop() !== "(") return NaN;
    } else if (t in prec) {
      while (
        ops.length > 0 &&
        ops[ops.length - 1] !== "(" &&
        (prec[ops[ops.length - 1] ?? ""] ?? 0) >= (prec[t] ?? 0)
      ) {
        out.push(ops.pop() ?? "");
      }
      ops.push(t);
    } else {
      return NaN;
    }
  }
  while (ops.length > 0) {
    const o = ops.pop();
    if (o === "(") return NaN;
    out.push(o ?? "");
  }
  const stack: number[] = [];
  for (const t of out) {
    if (typeof t === "number") {
      stack.push(t);
    } else {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) return NaN;
      switch (t) {
        case "+":
          stack.push(a + b);
          break;
        case "-":
          stack.push(a - b);
          break;
        case "*":
          stack.push(a * b);
          break;
        case "/":
          stack.push(b === 0 ? NaN : a / b);
          break;
        default:
          return NaN;
      }
    }
  }
  return stack.length === 1 ? (stack[0] ?? NaN) : NaN;
}
