/**
 * VROL-50 — PanelSection layout primitive.
 *
 * Reusable property-panel section with a title, optional description, optional
 * trailing slot (badge / action), and a body. Used for grouping related
 * fields inside Inspector / Settings sheets. Decoupled from Card so it can
 * nest inside an existing Card without doubled chrome.
 */

import type { ReactNode } from "react";

interface PanelSectionProps {
  readonly id?: string;
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly trailing?: ReactNode;
  readonly children: ReactNode;
  /** When true, the section gets a subtle border + padding around the body. */
  readonly bordered?: boolean;
}

export function PanelSection({
  id,
  title,
  description,
  trailing,
  children,
  bordered = false,
}: PanelSectionProps) {
  return (
    <section id={id} className="scroll-mt-4 space-y-2">
      {title || trailing ? (
        <header className="flex items-baseline justify-between gap-2">
          <div className="space-y-0.5">
            {title ? (
              <h3 className="font-heading text-xs font-medium tracking-wide uppercase">{title}</h3>
            ) : null}
            {description ? (
              <p className="text-muted-foreground text-xs leading-snug">{description}</p>
            ) : null}
          </div>
          {trailing ? <div className="shrink-0">{trailing}</div> : null}
        </header>
      ) : null}
      <div className={bordered ? "border-border rounded-md border p-3" : ""}>{children}</div>
    </section>
  );
}
