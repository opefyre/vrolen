/**
 * Project-flavored toast API.
 *
 * Re-exports Sonner's `toast` function so import sites use `@/lib/toast`
 * instead of "sonner" directly — lets us swap the underlying lib or layer on
 * project-wide policies (rate-limit, default durations, etc.) in one place.
 */
export { toast } from "sonner";
export type { ExternalToast } from "sonner";
