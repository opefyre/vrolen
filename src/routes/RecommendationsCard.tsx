/**
 * VROL-678 — auto-derived recommendation cards rendered from a ChainResult.
 * Hidden when nothing actionable is found.
 */

import { AlertTriangle, Lightbulb, Sparkles } from "lucide-react";

import type { ChainResult } from "@/engine";
import type { BufferCoverageInput } from "@/lib/buffer-coverage";
import {
  deriveRecommendations,
  type Recommendation,
  type RecommendationApply,
  type RecommendationSeverity,
} from "@/lib/recommendations";
import type { Distribution } from "@/engine/distribution";

interface RecommendationsCardProps {
  readonly result: ChainResult;
  /** VROL-902 — optional MTTR distribution; lets the recommendation surface
   *  tightly-coupled buffer warnings. Hidden when undefined. */
  readonly mttrDistribution?: Distribution;
  /** VROL-902 — per-edge buffer capacities + labels, in canvas-edge order. */
  readonly bufferEdges?: ReadonlyArray<BufferCoverageInput>;
  /** VROL-796 — when set, recommendations with apply payloads render an
   *  Apply button that invokes this handler. The host (EditorPage) applies
   *  the patch + re-runs the sim. */
  readonly onApply?: (rec: Recommendation, payload: RecommendationApply) => void;
}

const SEVERITY_STYLE: Record<RecommendationSeverity, { ring: string; icon: string }> = {
  high: { ring: "border-sim-blocked/40 bg-sim-blocked/5", icon: "text-sim-blocked-foreground" },
  medium: { ring: "border-sim-setup/40 bg-sim-setup/5", icon: "text-sim-setup-foreground" },
  low: { ring: "border-sim-running/40 bg-sim-running/5", icon: "text-sim-running" },
};

export function RecommendationsCard({
  result,
  mttrDistribution,
  bufferEdges,
  onApply,
}: RecommendationsCardProps) {
  const recs = deriveRecommendations(result, {
    ...(mttrDistribution ? { mttrDistribution } : {}),
    ...(bufferEdges ? { bufferEdges } : {}),
  });
  if (recs.length === 0) return null;
  return (
    <ul className="space-y-2" data-testid="recommendations">
      {recs.map((r) => {
        const style = SEVERITY_STYLE[r.severity];
        const Icon = r.severity === "high" ? AlertTriangle : Lightbulb;
        return (
          <li
            key={r.id}
            className={`flex items-start gap-3 rounded-md border border-l-4 p-3 ${style.ring}`}
          >
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.icon}`} aria-hidden />
            <div className="flex-1 space-y-1">
              <div className="text-sm font-semibold">{r.title}</div>
              <p className="text-foreground/80 text-sm leading-snug">{r.body}</p>
              {/* VROL-796 — Apply button + ΔKPI preview render when the
                  recommendation carries an apply payload. */}
              {r.apply && onApply ? (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="bg-foreground text-background hover:bg-foreground/85 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
                    onClick={() => {
                      if (r.apply) onApply(r, r.apply);
                    }}
                    aria-label={`Apply: ${r.title}`}
                  >
                    <Sparkles className="h-3 w-3" aria-hidden />
                    Apply
                  </button>
                  {r.previewLabel ? (
                    <span className="text-muted-foreground text-[11px]">{r.previewLabel}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
