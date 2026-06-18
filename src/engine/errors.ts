/**
 * User-facing error formatting for Zod validation issues.
 *
 * Zod's default messages are developer-flavored ("Expected number, received
 * undefined"). The simulator surfaces validation issues directly to users
 * inside the editor, so we want plain-language messages with the path
 * baked in.
 *
 * Pattern: call `formatZodError(error)` after a `safeParse` failure to get
 * an array of `{ path, message }` ready to render in the validation panel.
 */

import type { ZodError, ZodIssue } from "zod";

export interface FormattedIssue {
  /** Dot-notation path to the offending field, e.g. `lines[0].stations[2].cycleTimeMs`. */
  readonly path: string;
  /** Plain-English message. */
  readonly message: string;
}

function humanizePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path
    .map((seg, i) => {
      if (typeof seg === "number") return `[${String(seg)}]`;
      if (typeof seg === "symbol") return `[${String(seg)}]`;
      return i === 0 ? seg : `.${seg}`;
    })
    .join("");
}

function humanizeIssue(issue: ZodIssue): string {
  // Zod v4 surfaces a `code` discriminator + a human message; we override
  // the most common cases. Anything not matched falls through to the
  // upstream message — Zod's defaults are good enough for the long tail.
  switch (issue.code) {
    case "invalid_type":
      if (issue.message.toLowerCase().includes("undefined")) {
        return "is required";
      }
      return `must be a ${String(issue.expected)}`;
    case "too_small": {
      const min = issue.minimum;
      if (min === 0) return "cannot be negative";
      if (min === 1) return "is required";
      return `must be at least ${String(min)}`;
    }
    case "too_big":
      return `must be at most ${String(issue.maximum)}`;
    case "invalid_value":
      // Discriminator mismatch on enums / literals — Zod calls this "invalid_value" in v4.
      return issue.message || "is not a valid value";
    default:
      return issue.message;
  }
}

export function formatZodError(error: ZodError): FormattedIssue[] {
  return error.issues.map((issue) => ({
    path: humanizePath(issue.path),
    message: humanizeIssue(issue),
  }));
}

/** Render an array of formatted issues as a single multi-line string for logs and toasts. */
export function formatZodErrorString(error: ZodError): string {
  return formatZodError(error)
    .map((i) => `  ${i.path}: ${i.message}`)
    .join("\n");
}
