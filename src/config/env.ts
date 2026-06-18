import { z } from "zod";

/**
 * Browser-facing environment variables.
 *
 * Vite exposes only variables prefixed with `VITE_` to the client bundle. Anything
 * sensitive (service-role keys, server-only secrets) lives in server-side env
 * (Edge Functions, CI runners) and never reaches the browser.
 *
 * Adding a new env var requires touching exactly two files:
 *   1. .env.example — add the name with a comment describing it
 *   2. this file — add the matching field to the schema below
 *
 * The schema is validated at module load. A missing or malformed required var
 * throws immediately with an actionable error naming each offending field.
 *
 * Outside this module, never read `import.meta.env` directly — the ESLint rule
 * `no-restricted-syntax` will fail the lint check. Always import from
 * `@/config/env` so the types and validation stay centralized.
 */
const EnvSchema = z.object({
  /** Supabase project URL — e.g. `https://<ref>.supabase.co` */
  VITE_SUPABASE_URL: z.string().url(),

  /** Supabase publishable (browser-safe) key — starts with `sb_publishable_` */
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  /** Sentry DSN for client error reporting — optional during local dev */
  VITE_SENTRY_DSN: z.string().url().optional(),

  /** Build mode injected by Vite (`development`, `production`, `test`) */
  MODE: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid or missing environment variables:\n${issues}\n\n` +
      `See .env.example for the full list of required variables. Copy it to .env.local and fill in values.`,
  );
}

export const env: Env = parsed.data;
