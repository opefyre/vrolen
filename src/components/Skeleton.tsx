import { cn } from "@/lib/utils";

interface SkeletonProps {
  readonly className?: string;
  /** ARIA label for screen readers — "loading [thing]". */
  readonly label?: string;
}

/**
 * Animated placeholder for loading content. Respects prefers-reduced-motion:
 * the shimmer animation is omitted entirely (just shows the muted background)
 * when the user prefers reduced motion.
 *
 * Compose multiple Skeletons together to mimic the shape of the eventual
 * content — e.g., one for a title, three for list rows, etc.
 */
export function Skeleton({ className, label = "Loading" }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-live="polite"
      className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)}
    />
  );
}
