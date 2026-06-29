/**
 * VROL-1051 — label the Apply button with the specific lever so the
 * user knows what'll happen before they click. Falls back to "Apply"
 * for kinds that don't carry actionable details (sampling:flag /
 * reliability:flag are info-only — they hint the user toward a
 * setting, not a one-click mutation).
 */
import type { ActionApplyPayload } from "@/lib/derive-action-card";

export function applyLabel(payload: ActionApplyPayload): string {
  switch (payload.kind) {
    case "cycle:halve":
      return `Apply cycle 0.5× on ${payload.stationLabel}`;
    case "cycle:scaleAll":
      return `Apply cycle ${payload.multiplier.toFixed(2)}× line-wide`;
    case "buffer:grow":
      return "Apply buffer +5";
    case "tool-pool:grow":
      return `Apply ${payload.poolName} pool +1`;
    case "tool-pool:scaleAll":
      return `Apply tool pools +${String(payload.delta)}`;
    case "energy:scale":
      return `Apply energy ${payload.multiplier.toFixed(2)}× on ${payload.stationLabel}`;
    case "capacity:set":
      return `Apply capacity ${String(payload.capacity)} on ${payload.stationLabel}`;
    case "capacity:scaleAll":
      return `Apply capacity +${String(payload.delta)} line-wide`;
    case "reliability:flag":
    case "sampling:flag":
      return "Apply";
  }
}
