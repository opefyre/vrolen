/**
 * VROL-60 — Custom industrial icons that aren't well-covered by Lucide.
 *
 * Lucide stays the default icon set (covers ~95% of UI affordances).
 * This module adds a handful of factory-floor-specific glyphs: bottle,
 * conveyor, pallet, robot arm, and tank. Same API shape as Lucide
 * icons (props match React.SVGProps) so they're drop-in.
 */

import type { SVGProps } from "react";

const BASE_PROPS = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
} satisfies SVGProps<SVGSVGElement>;

export function BottleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE_PROPS} {...props}>
      <path d="M10 2h4v4l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3V2z" />
      <line x1="9" y1="13" x2="15" y2="13" />
    </svg>
  );
}

export function ConveyorIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE_PROPS} {...props}>
      <rect x="2" y="11" width="20" height="3" rx="1.5" />
      <circle cx="5" cy="18" r="2" />
      <circle cx="19" cy="18" r="2" />
      <rect x="8" y="5" width="3" height="3" />
      <rect x="13" y="5" width="3" height="3" />
    </svg>
  );
}

export function PalletIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE_PROPS} {...props}>
      <rect x="3" y="13" width="18" height="3" />
      <line x1="5" y1="16" x2="5" y2="20" />
      <line x1="12" y1="16" x2="12" y2="20" />
      <line x1="19" y1="16" x2="19" y2="20" />
      <line x1="3" y1="20" x2="21" y2="20" />
    </svg>
  );
}

export function RobotArmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE_PROPS} {...props}>
      <line x1="4" y1="20" x2="4" y2="14" />
      <line x1="4" y1="14" x2="11" y2="8" />
      <line x1="11" y1="8" x2="18" y2="11" />
      <circle cx="4" cy="20" r="1.5" />
      <circle cx="4" cy="14" r="1.5" />
      <circle cx="11" cy="8" r="1.5" />
      <path d="M16 9l4 2-1 3-4-2z" />
    </svg>
  );
}

export function TankIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...BASE_PROPS} {...props}>
      <ellipse cx="12" cy="5" rx="7" ry="2" />
      <path d="M5 5v14a7 2 0 0 0 14 0V5" />
      <path d="M5 12a7 2 0 0 0 14 0" />
    </svg>
  );
}
