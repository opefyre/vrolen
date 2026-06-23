/**
 * VROL-678 — auto-derived recommendation cards rendered from a ChainResult.
 * Hidden when nothing actionable is found.
 */

import { AlertTriangle, Lightbulb } from "lucide-react";

import type { ChainResult } from "@/engine";
import type { BufferCoverageInput } from "@/lib/buffer-coverage";
import { deriveRecommendations, type RecommendationSeverity } from "@/lib/recommendations";
import type { Distribution } from "@/engine/distribution";

interface RecommendationsCardProps {
  readonly result: ChainResult;
  /** VROL-902 — optional MTTR distribution; lets the recommendation surface
   *  tightly-coupled buffer warnings. Hidden when undefined. */
  readonly mttrDistribution?: Distribution;
  /** VROL-902 — per-edge buffer capacities + labels, in canvas-edge order. */
  readonly bufferEdges?: ReadonlyArray<BufferCoverageInput>;
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
            <div className="space-y-1">
              <div className="text-sm font-semibold">{r.title}</div>
              <p className="text-foreground/80 text-sm leading-snug">{r.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
