"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { RotateCcw } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const waveform = Array.from({ length: 64 }, (_, i) =>
  Math.round(8 + Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.39)) * 42),
);
const ease = [0.16, 1, 0.3, 1] as const;

/** An illustrative timeline, independent of search or playback state. */
export function MomentGraphic() {
  const reduced = usePrefersReducedMotion();
  const [replay, setReplay] = useState(0);

  return (
    <div className="mx-auto mb-9 w-full max-w-lg">
      <div className="mb-3 flex items-center justify-between text-xs text-text-muted">
        <span>Every video has a moment.</span>
        {!reduced && (
          <button
            type="button"
            onClick={() => setReplay((value) => value + 1)}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-surface-hover hover:text-text"
            aria-label="Replay timeline animation"
          >
            <RotateCcw size={12} /> Replay
          </button>
        )}
      </div>
      <div key={`${replay}-${reduced}`} aria-hidden="true" className="relative overflow-hidden rounded-xl border border-border bg-surface px-5 pb-4 pt-7 sm:px-7">
        <div className="relative">
          <div className="flex h-16 items-center justify-between gap-[3px]">
            {waveform.map((height, i) => (
              <motion.span
                key={i}
                className={`min-w-0 flex-1 rounded-full ${i >= 27 && i <= 44 ? "bg-accent" : "bg-border-strong"}`}
                style={{ height }}
                initial={reduced ? false : { scaleY: 0.15, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ duration: reduced ? 0 : 0.5, delay: reduced ? 0 : i * 0.006, ease }}
              />
            ))}
          </div>
          <motion.div
            className="absolute inset-y-0 left-[42%] w-[29%] origin-left rounded border border-accent/70 bg-accent-soft"
            initial={reduced ? false : { scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            transition={{ duration: reduced ? 0 : 0.65, delay: reduced ? 0 : 1.6, ease }}
          >
            <span className="absolute -left-px top-1/2 h-5 w-[3px] -translate-y-1/2 rounded bg-accent" />
            <span className="absolute -right-px top-1/2 h-5 w-[3px] -translate-y-1/2 rounded bg-accent" />
          </motion.div>
          <motion.div
            className="absolute -top-2 bottom-0 w-px bg-text"
            initial={reduced ? false : { left: "0%", opacity: 0 }}
            animate={{ left: "71%", opacity: 1 }}
            transition={{ duration: reduced ? 0 : 1.8, delay: reduced ? 0 : 0.4, ease: "easeInOut" }}
          >
            <span className="absolute -left-[3px] top-0 h-1.5 w-[7px] rounded-b-sm bg-text" />
          </motion.div>
          <div className="mt-3 flex justify-between border-t border-border pt-2 font-mono text-[10px] text-text-muted">
            <span>00:00</span><span>00:30</span><span>01:00</span><span>01:30</span>
          </div>
        </div>
        <motion.div
          className="mt-3 flex items-center gap-2 text-xs text-accent"
          initial={reduced ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0 : 0.35, delay: reduced ? 0 : 2.2 }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Find it. Save it. Make it yours.
        </motion.div>
      </div>
    </div>
  );
}
