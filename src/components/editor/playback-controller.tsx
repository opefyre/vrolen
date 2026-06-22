/**
 * Live simulation playback controls.
 *
 * Renders a play/pause/scrubber/speed strip below the canvas. Owns the
 * `playbackTimeMs` state and ticks it forward via requestAnimationFrame
 * when playing. Parent passes (result, horizonMs) + a callback that
 * receives the current playback ms whenever it changes.
 */

import { GaugeCircle, Pause, Play, Rewind, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChainResult } from "@/engine";

interface PlaybackControllerProps {
  readonly result: ChainResult;
  readonly horizonMs: number;
  readonly playbackMs: number;
  readonly onPlaybackChange: (tMs: number) => void;
  /**
   * Counter that bumps every time a fresh run completes. When it changes,
   * the controller runs a 3-2-1 countdown then auto-starts playback. Pass
   * undefined to opt out.
   */
  readonly autoPlayNonce?: number;
}

const SPEEDS: readonly { readonly label: string; readonly factor: number }[] = [
  { label: "0.5×", factor: 0.5 },
  { label: "1×", factor: 1 },
  { label: "2×", factor: 2 },
  { label: "5×", factor: 5 },
  { label: "10×", factor: 10 },
  { label: "50×", factor: 50 },
  { label: "200×", factor: 200 },
];

function fmtTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PlaybackController({
  result,
  horizonMs,
  playbackMs,
  onPlaybackChange,
  autoPlayNonce,
}: PlaybackControllerProps) {
  const [playing, setPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<number>(5);
  const [countdown, setCountdown] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);
  const speedRef = useRef<number>(speed);
  const onChangeRef = useRef(onPlaybackChange);
  const playbackRef = useRef<number>(playbackMs);

  // Keep refs synced inside an effect (per react-hooks/refs rule).
  useEffect(() => {
    speedRef.current = speed;
    onChangeRef.current = onPlaybackChange;
    playbackRef.current = playbackMs;
  });

  // Auto-play countdown after a fresh run. Watches autoPlayNonce; when it
  // increments, runs 3-2-1 then setPlaying(true). User can interrupt by
  // clicking play/pause — that cancels the pending start.
  useEffect(() => {
    if (autoPlayNonce === undefined || autoPlayNonce === 0) return;
    if (result.samples.length < 2) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Schedule every state mutation — including the initial "3" — through
    // a timer so the effect body itself doesn't synchronously setState.
    [3, 2, 1].forEach((n, i) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) setCountdown(n);
        }, 800 * i),
      );
    });
    timers.push(
      setTimeout(() => {
        if (!cancelled) {
          setCountdown(null);
          onChangeRef.current(0);
          setPlaying(true);
        }
      }, 2400),
    );
    return () => {
      cancelled = true;
      timers.forEach((t) => {
        clearTimeout(t);
      });
    };
  }, [autoPlayNonce, result]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    lastTickRef.current = performance.now();
    const tick = (now: number): void => {
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      const next = playbackRef.current + dt * speedRef.current;
      if (next >= horizonMs) {
        onChangeRef.current(horizonMs);
        setPlaying(false);
        return;
      }
      onChangeRef.current(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, horizonMs]);

  const samplesAvailable = result.samples.length >= 2;
  const disabled = !samplesAvailable;

  return (
    <>
      {countdown !== null ? (
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
        >
          <div
            key={countdown}
            className="font-heading text-foreground/90 bg-card/80 ring-border animate-in zoom-in-50 fade-in-0 flex h-32 w-32 items-center justify-center rounded-full text-7xl font-bold tabular-nums shadow-2xl ring-1 backdrop-blur duration-300"
          >
            {countdown}
          </div>
        </div>
      ) : null}
      <div
        role="region"
        aria-label="Simulation playback"
        className="border-border bg-card/95 supports-[backdrop-filter]:bg-card/80 z-10 flex flex-wrap items-center gap-2 rounded-md border p-2 backdrop-blur"
      >
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            setCountdown(null);
            if (playbackRef.current >= horizonMs) {
              onChangeRef.current(0);
            }
            setPlaying((p) => !p);
          }}
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Skip back 5s"
          onClick={() => {
            onPlaybackChange(Math.max(0, playbackMs - 5000));
          }}
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Skip forward 5s"
          onClick={() => {
            onPlaybackChange(Math.min(horizonMs, playbackMs + 5000));
          }}
        >
          <SkipForward className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label="Reset to start"
          onClick={() => {
            setPlaying(false);
            onPlaybackChange(0);
          }}
        >
          <Rewind className="h-4 w-4" />
        </Button>
        <input
          type="range"
          aria-label="Scrub playback"
          min={0}
          max={horizonMs}
          step={Math.max(1, Math.floor(horizonMs / 1000))}
          value={Math.round(playbackMs)}
          disabled={disabled}
          onChange={(e) => {
            setPlaying(false);
            onPlaybackChange(Number(e.target.value));
          }}
          className="accent-sim-running min-w-32 flex-1"
        />
        <span className="text-muted-foreground min-w-24 text-right font-mono text-xs tabular-nums">
          {fmtTime(playbackMs)} / {fmtTime(horizonMs)}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          <GaugeCircle className="text-muted-foreground h-4 w-4" aria-hidden />
          <select
            value={String(speed)}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
            }}
            disabled={disabled}
            className="border-border bg-background rounded-md border px-1.5 py-0.5 text-xs"
            aria-label="Speed"
          >
            {SPEEDS.map((s) => (
              <option key={s.factor} value={s.factor}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
