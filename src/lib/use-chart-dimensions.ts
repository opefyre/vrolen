/**
 * Hook that observes an element's size and returns a responsive
 * viewBox-friendly { width, height } pair. Use this for any chart SVG
 * so its viewBox tracks the container — no more squashed or stretched
 * plots when the panel resizes.
 *
 * Returns sensible non-zero defaults so the first render doesn't
 * produce a 0×0 viewBox that hides the chart.
 */

import { useEffect, useRef, useState } from "react";

export interface ChartDimensions<T extends HTMLElement = HTMLDivElement> {
  readonly containerRef: React.RefObject<T | null>;
  readonly width: number;
  readonly height: number;
}

export function useChartDimensions<T extends HTMLElement = HTMLDivElement>(
  initial: { width: number; height: number } = { width: 600, height: 160 },
): ChartDimensions<T> {
  const containerRef = useRef<T | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>(initial);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 1 && height > 1) {
        const w = Math.round(width);
        const h = Math.round(height);
        setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return { containerRef, width: size.width, height: size.height };
}
