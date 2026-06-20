import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NumberFieldProps {
  readonly id?: string;
  readonly label?: string;
  /** VROL-661 — optional slot rendered next to the label (e.g. validation dot). */
  readonly labelSuffix?: ReactNode;
  readonly value: number;
  readonly onChange: (next: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly helperText?: string;
  readonly ariaLabel?: string;
  readonly className?: string;
  readonly inputClassName?: string;
  readonly disabled?: boolean;
}

/**
 * VROL-645 — single number-input primitive used in the Inspector + Drawer.
 *
 * Behavior: free-form typing during edit (the `value` prop seeds the local
 * draft); clamping + onChange only fire on blur or Enter, so the user
 * isn't fighting the clamp while typing intermediate values like "-" or
 * a half-typed number. Pressing Esc reverts to the prop value. Tab and
 * arrow-key increment behave like a native number input.
 */
export function NumberField({
  id,
  label,
  labelSuffix,
  value,
  onChange,
  min,
  max,
  step = 1,
  helperText,
  ariaLabel,
  className,
  inputClassName,
  disabled,
}: NumberFieldProps) {
  // Render-time compare-and-set: when the parent's `value` prop changes
  // (e.g., after our commit calls onChange and the parent re-renders), sync
  // the draft string. Avoids the react-hooks/set-state-in-effect warning.
  const [draft, setDraft] = useState<string>(String(value));
  const [seenValue, setSeenValue] = useState<number>(value);
  if (value !== seenValue) {
    setSeenValue(value);
    setDraft(String(value));
  }

  const commit = useCallback(
    (raw: string): void => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        setDraft(String(value));
        return;
      }
      let clamped = parsed;
      if (typeof min === "number" && clamped < min) clamped = min;
      if (typeof max === "number" && clamped > max) clamped = max;
      if (clamped !== value) onChange(clamped);
      setDraft(String(clamped));
    },
    [value, min, max, onChange],
  );

  // Figma-style scrubby input — drag the label horizontally to scrub the
  // value. Shift = ×10. Cursor changes to ew-resize on hover.
  const scrubStartRef = useRef<{
    clientX: number;
    valueAt: number;
  } | null>(null);
  const onLabelPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      if (disabled) return;
      // Only left button.
      if (e.button !== 0) return;
      e.preventDefault();
      scrubStartRef.current = { clientX: e.clientX, valueAt: value };
      (e.target as Element).setPointerCapture?.(e.pointerId);
    },
    [disabled, value],
  );
  const onLabelPointerMove = useCallback(
    (e: React.PointerEvent): void => {
      const start = scrubStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.clientX;
      // 1 px = 1 step; shift = 10 steps
      const sensitivity = e.shiftKey ? step * 10 : step;
      const raw = start.valueAt + dx * sensitivity;
      // Snap to step grid
      const snapped = Math.round(raw / step) * step;
      let clamped = snapped;
      if (typeof min === "number" && clamped < min) clamped = min;
      if (typeof max === "number" && clamped > max) clamped = max;
      if (clamped !== value) onChange(clamped);
    },
    [step, min, max, value, onChange],
  );
  const onLabelPointerUp = useCallback((e: React.PointerEvent): void => {
    scrubStartRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }, []);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label ? (
        <label
          htmlFor={id}
          className={cn(
            "text-muted-foreground flex items-center gap-1.5 text-xs font-medium select-none",
            disabled ? "" : "cursor-ew-resize",
          )}
          onPointerDown={onLabelPointerDown}
          onPointerMove={onLabelPointerMove}
          onPointerUp={onLabelPointerUp}
          onPointerCancel={onLabelPointerUp}
          title={disabled ? undefined : "Drag to scrub the value · Shift = ×10"}
        >
          {label}
          {labelSuffix}
        </label>
      ) : null}
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={(e) => {
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn("font-mono tabular-nums", inputClassName)}
      />
      {helperText ? <p className="text-muted-foreground text-[11px]">{helperText}</p> : null}
    </div>
  );
}
