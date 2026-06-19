/**
 * Accordion — single-section collapsible card (VROL-635 / VROL-636).
 *
 * Header is a full-width clickable row showing an optional leading icon, a
 * title, an optional status chip on the right, and a chevron that rotates
 * 180° when expanded. The body mounts only while expanded (so heavy form
 * inputs don't pay their render cost when collapsed).
 *
 * Stateful: the caller owns the open/closed boolean + the onToggle callback.
 * This gives the parent control over persistence (sessionStorage, etc.) and
 * lets multiple instances coordinate (e.g., one-open-at-a-time behavior).
 */

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

import { Card } from "./card";

export interface AccordionProps {
  readonly title: string;
  readonly icon?: React.ReactNode;
  readonly status?: React.ReactNode;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children?: React.ReactNode;
  readonly className?: string;
  /** Optional click target for the entire header (defaults to <button>). */
  readonly headerAs?: "button" | "div";
}

export function Accordion({
  title,
  icon,
  status,
  expanded,
  onToggle,
  children,
  className,
  headerAs = "button",
}: AccordionProps) {
  const Header = headerAs === "button" ? "button" : "div";
  return (
    <Card className={cn("overflow-hidden", className)}>
      <Header
        {...(headerAs === "button" ? { type: "button" as const, "aria-expanded": expanded } : {})}
        onClick={onToggle}
        className={cn(
          "hover:bg-accent/40 flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors",
          headerAs === "button" ? "cursor-pointer" : "",
        )}
      >
        {icon ? <span className="text-muted-foreground shrink-0">{icon}</span> : null}
        <span className="font-heading text-sm font-semibold">{title}</span>
        {status ? <span className="ml-auto">{status}</span> : <span className="ml-auto" />}
        <ChevronDown
          className={cn(
            "text-muted-foreground h-4 w-4 transition-transform",
            expanded ? "rotate-180" : "",
            status ? "ml-2" : "",
          )}
        />
      </Header>
      {expanded ? <div className="border-border space-y-3 border-t p-4">{children}</div> : null}
    </Card>
  );
}

/**
 * A small chip used by Accordion `status` props. Uses sim-* tokens for the
 * "on" / "off" / "configured" semantics so the visual vocabulary matches the
 * rest of the editor.
 */
export function AccordionStatus({
  tone = "off",
  children,
}: {
  tone?: "on" | "off" | "configured";
  children: React.ReactNode;
}) {
  const cls =
    tone === "on"
      ? "bg-sim-running/15 text-sim-running"
      : tone === "configured"
        ? "bg-sim-setup/15 text-sim-setup-foreground"
        : "bg-muted text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", cls)}>{children}</span>
  );
}
