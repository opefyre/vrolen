/**
 * VROL-948 — single "next thing to do" card derived from the latest run.
 * Sits above the OEE breakdown so the reader gets the action before the
 * decomposed table.
 */

import type { ChainResult } from "@/engine";
import { deriveActionCard, type ActionApplyPayload } from "@/lib/derive-action-card";
import { Button } from "@/components/ui/button";

interface Props {
  readonly result: ChainResult;
  readonly onApply?: (payload: ActionApplyPayload) => void;
}

export function ActionCard({ result, onApply }: Props) {
  const card = deriveActionCard(result);
  if (!card) return null;
  const toneClass =
    card.tone === "primary"
      ? "border-sim-running/40 bg-sim-running/5"
      : card.tone === "warn"
        ? "border-sim-down/40 bg-sim-down/5"
        : "border-border bg-card";
  return (
    <div className={`space-y-1.5 rounded-md border p-3 ${toneClass}`} data-testid="action-card">
      <div className="text-foreground text-sm font-medium">{card.title}</div>
      <p className="text-muted-foreground text-xs leading-relaxed">{card.body}</p>
      {card.apply && onApply ? (
        <div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onApply(card.apply!);
            }}
          >
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}
