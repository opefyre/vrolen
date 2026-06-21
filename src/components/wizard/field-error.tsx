/**
 * VROL-820 — inline field error used across the wizard steps.
 *
 * Sentinel for "no error": pass `message={undefined}` and the component
 * renders nothing. Sentinel for "shown": pass any non-empty string and
 * the row appears with the lucide AlertCircle glyph + red text, matching
 * the inline error pattern in `src/components/editor/validation-panel.tsx`.
 */

import { AlertCircle } from "lucide-react";

export function FieldError({ message }: { readonly message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sim-down mt-1 flex items-center gap-1 text-[11px] font-medium">
      <AlertCircle className="h-3 w-3 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}
