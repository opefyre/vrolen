/**
 * VROL-964 — wrap a term in a tooltip that shows its definition.
 *
 * Usage: <GlossaryTerm term="oee">OEE</GlossaryTerm> renders the
 * children text with a dotted-underline hint; the native title tooltip
 * carries the definition. Lightweight on purpose — no popover library
 * dependency, no extra render cost.
 */

import type { ReactNode } from "react";
import { lookupGlossary } from "@/lib/glossary";

interface Props {
  readonly term: string;
  readonly children: ReactNode;
}

export function GlossaryTerm({ term, children }: Props) {
  const entry = lookupGlossary(term);
  if (!entry) {
    return <>{children}</>;
  }
  const title = `${entry.title}\n\n${entry.body}${entry.source ? `\n\nSource: ${entry.source}` : ""}`;
  return (
    <span
      className="decoration-muted-foreground/40 cursor-help underline decoration-dotted underline-offset-2"
      title={title}
      data-testid={`glossary-${term}`}
    >
      {children}
    </span>
  );
}
