/**
 * VROL-942 — tool-pool dashboard widget. Shows each declared pool's
 * {name, capacity, in-use count}. Static for now (capacity from
 * settings.toolPools; in-use is the number of stations that declare the
 * pool as requiredToolPool — a worst-case upper bound on demand).
 *
 * Live per-snapshot accounting would need a new field on PlaybackSnapshot
 * to surface toolPoolAvailable per sample; tracked as a follow-up. The
 * static view is still useful for the "is my line tool-bound?" read.
 */

interface ToolPool {
  readonly name: string;
  readonly capacity: number;
}

interface Props {
  readonly pools: ReadonlyArray<ToolPool>;
  /** Map of poolName → array of station labels that declare requiredToolPool. */
  readonly consumersByPool: Readonly<Record<string, readonly string[]>>;
}

export function ToolPoolWidget({ pools, consumersByPool }: Props) {
  if (!pools || pools.length === 0) return null;
  return (
    <div
      className="border-border bg-card/95 text-card-foreground absolute right-3 bottom-3 z-10 max-w-[14rem] rounded-md border p-2 shadow-sm"
      data-testid="tool-pool-widget"
    >
      <div className="text-muted-foreground mb-1.5 text-[10px] font-medium tracking-wide uppercase">
        Tool pools
      </div>
      <div className="space-y-1.5">
        {pools.map((p) => {
          const consumers = consumersByPool[p.name] ?? [];
          const ratio = consumers.length / Math.max(1, p.capacity);
          const tone = ratio <= 1 ? "bg-sim-running" : ratio <= 2 ? "bg-sim-setup" : "bg-sim-down";
          return (
            <div key={p.name} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-foreground truncate text-xs font-medium">{p.name}</span>
                <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
                  {consumers.length}/{p.capacity}
                </span>
              </div>
              <div className="bg-muted h-1 overflow-hidden rounded-full">
                <div
                  className={`${tone} h-full rounded-full`}
                  style={{ width: `${String(Math.min(100, ratio * 100))}%` }}
                />
              </div>
              {consumers.length > 0 ? (
                <div
                  className="text-muted-foreground line-clamp-2 text-[10px]"
                  title={consumers.join(", ")}
                >
                  {consumers.join(", ")}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
