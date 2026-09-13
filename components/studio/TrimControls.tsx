"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { formatTimecode } from "@/lib/format";

interface TrimControlsProps {
  duration: number;
  start: number;
  end: number;
  currentTime: number;
  onChange: (start: number, end: number) => void;
  onScrub: (time: number) => void;
}

type Handle = "start" | "end" | null;

export function TrimControls({ duration, start, end, currentTime, onChange, onScrub }: TrimControlsProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<Handle>(null);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  useEffect(() => {
    if (!dragging) return;

    function handleMove(e: PointerEvent) {
      const time = timeFromClientX(e.clientX);
      if (dragging === "start") {
        onChange(Math.min(time, end - 0.5), end);
      } else {
        onChange(start, Math.max(time, start + 0.5));
      }
    }
    function handleUp() {
      setDragging(null);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, start, end, onChange, timeFromClientX]);

  const startPct = duration ? (start / duration) * 100 : 0;
  const endPct = duration ? (end / duration) * 100 : 100;
  const playPct = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between font-mono text-xs tabular-nums text-text-muted">
        <span>{formatTimecode(start)}</span>
        <span className="text-text-faint">selected {formatTimecode(end - start)}</span>
        <span>{formatTimecode(end)}</span>
      </div>
      <div
        ref={trackRef}
        onClick={(e) => onScrub(timeFromClientX(e.clientX))}
        className="relative h-9 cursor-pointer rounded-md bg-surface-raised"
      >
        <div className="absolute inset-y-0 left-0 right-0 rounded-md" />
        <motion.div
          className="absolute inset-y-0 rounded-md bg-accent-soft"
          animate={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          transition={{ duration: dragging ? 0 : 0.15 }}
        />
        <div
          className="absolute top-0 z-20 h-full w-px bg-white/80"
          style={{ left: `${playPct}%` }}
          aria-hidden
        />
        {(["start", "end"] as const).map((handle) => (
          <motion.div
            key={handle}
            onPointerDown={(e) => {
              e.preventDefault();
              setDragging(handle);
            }}
            whileHover={{ scaleY: 1.08 }}
            animate={{ left: `${handle === "start" ? startPct : endPct}%` }}
            transition={{ duration: dragging === handle ? 0 : 0.15 }}
            className="absolute top-0 z-10 h-full w-3 -translate-x-1/2 cursor-ew-resize touch-none rounded bg-accent"
            role="slider"
            aria-label={handle === "start" ? "Trim start" : "Trim end"}
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={handle === "start" ? start : end}
            tabIndex={0}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 5 : 1;
              if (e.key === "ArrowLeft") {
                if (handle === "start") onChange(Math.max(0, start - step), end);
                else onChange(start, Math.max(start + 0.5, end - step));
              } else if (e.key === "ArrowRight") {
                if (handle === "start") onChange(Math.min(end - 0.5, start + step), end);
                else onChange(start, Math.min(duration, end + step));
              }
            }}
          />
        ))}
      </div>
    </div>
  );
}
