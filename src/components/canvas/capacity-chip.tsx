/**
 * VROL-650 — small chip rendered on canvas station nodes when their
 * capacity > 1. Pure component so it's unit-testable without the ReactFlow
 * context StationNode lives inside.
 */

interface CapacityChipProps {
  readonly capacity: number;
}

export function CapacityChip({ capacity }: CapacityChipProps) {
  return (
    <span
      className="bg-sim-running/15 text-sim-running rounded-full px-1.5 py-0.5"
      title={`${String(capacity)} parallel cycles`}
      data-testid="capacity-chip"
    >
      ×{capacity}
    </span>
  );
}
