import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
  readonly icon?: ComponentType<{ className?: string }>;
  readonly title: string;
  readonly body?: ReactNode;
  readonly action?: ReactNode;
}

/**
 * Centered empty-state block. Used wherever a list, panel, or canvas has
 * nothing to show — "no scenarios yet", "no runs yet", etc.
 *
 * One responsibility per slot: icon for visual anchor, title for the headline,
 * body for context, action for the next step. All optional except title.
 */
export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  return (
    <div className="border-border bg-card text-card-foreground flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      {Icon ? (
        <div className="bg-muted text-muted-foreground flex h-12 w-12 items-center justify-center rounded-full">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
      <h3 className="font-heading text-base font-semibold tracking-tight">{title}</h3>
      {body ? <div className="text-muted-foreground max-w-sm text-sm">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
