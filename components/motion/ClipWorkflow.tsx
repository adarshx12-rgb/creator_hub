"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { AudioLines, Check, Crop, RotateCcw, Scissors, WandSparkles } from "lucide-react";
import { formatTimecode } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const ease = [0.16, 1, 0.3, 1] as const;
const BAR_COUNT = 48;
const SECONDS_PER_BAR = 2;
const SELECT_START = 21;
const SELECT_END = 33;
const selectLeft = `${(SELECT_START / BAR_COUNT) * 100}%`;
const selectRight = `${(SELECT_END / BAR_COUNT) * 100}%`;
const selectWidth = `${((SELECT_END - SELECT_START) / BAR_COUNT) * 100}%`;
const CROP_MODES = ["Original", "9:16", "1:1"];

// Integer-only pseudo-random heights keep server and client markup identical.
const BARS = (() => {
  let seed = 11;
  return Array.from({ length: BAR_COUNT }, () => {
    seed = (seed * 9301 + 49297) % 233280;
    return 24 + Math.floor((seed * 76) / 233280);
  });
})();

const STEPS = [
  { icon: WandSparkles, label: "AI-suggested highlight", delay: 1.9 },
  { icon: Crop, label: "Reframed to 9:16", delay: 2.3 },
  { icon: Check, label: `${(SELECT_END - SELECT_START) * SECONDS_PER_BAR} sec selected`, delay: 2.7 },
];

const CORNERS = [
  "left-0 top-0 rounded-tl-md border-l-2 border-t-2",
  "right-0 top-0 rounded-tr-md border-r-2 border-t-2",
  "bottom-0 left-0 rounded-bl-md border-b-2 border-l-2",
  "bottom-0 right-0 rounded-br-md border-b-2 border-r-2",
];

/** Illustrative clipping sequence; never represents a real video, active search, or export. */
export function ClipWorkflow() {
  const reduced = usePrefersReducedMotion();
  const [replay, setReplay] = useState(0);

  return (
    <figure className="flex w-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-b from-surface-raised/80 to-surface shadow-[0_24px_80px_-40px_#000]">
      <div className="flex min-h-14 items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-soft text-accent">
          <Scissors size={13} />
        </span>
        <span className="text-xs font-medium text-text">Clip workflow</span>
        <span className="ml-auto rounded-full border border-border-strong px-2 py-0.5 text-[10px] text-text-muted">Example</span>
        {!reduced && (
          <button
            type="button"
            onClick={() => setReplay((value) => value + 1)}
            aria-label="Replay the clip workflow example"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      <ClipScene key={`${replay}-${reduced}`} reduced={reduced} />
      <figcaption className="sr-only">
        An illustrated clipping example: a 24-second AI-suggested highlight is selected on a waveform timeline and reframed into a vertical 9:16 preview.
      </figcaption>
    </figure>
  );
}

function ClipScene({ reduced }: { reduced: boolean }) {
  const [phase, setPhase] = useState(reduced ? 2 : 0);

  useEffect(() => {
    if (reduced) return;
    const timers = [window.setTimeout(() => setPhase(1), 1100), window.setTimeout(() => setPhase(2), 1700)];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [reduced]);

  const at = (delay: number, duration = 0.5) => (reduced ? { duration: 0 } : { delay, duration, ease });
  const from = <T,>(value: T) => (reduced ? false : value);
  const cropMode = phase >= 2 ? 1 : 0;

  return (
    <div aria-hidden="true" className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-1 gap-4">
        <div className="relative aspect-[9/16] w-[36%] max-w-[9.5rem] shrink-0 self-start overflow-hidden rounded-xl bg-bg shadow-[0_18px_40px_-20px_#000] ring-1 ring-white/10">
          <motion.div className="absolute inset-0" initial={from({ scale: 1.45, x: "12%" })} animate={{ scale: 1, x: "0%" }} transition={at(1.7, 0.9)}>
            <SpeakerArt />
          </motion.div>
          <motion.div className="absolute inset-2" initial={from({ opacity: 0, scale: 1.2 })} animate={{ opacity: 1, scale: 1 }} transition={at(1.7, 0.55)}>
            {CORNERS.map((corner) => (
              <span key={corner} className={`absolute h-3 w-3 border-accent ${corner}`} />
            ))}
          </motion.div>
          <span className="absolute left-2.5 top-2.5 rounded-full bg-black/55 px-1.5 py-0.5 font-mono text-[9px] text-white backdrop-blur-sm">
            {cropMode === 1 ? "9:16" : "16:9"}
          </span>
          <motion.span
            className="absolute inset-x-2.5 bottom-5 flex items-center justify-center gap-1 whitespace-nowrap rounded-full bg-black/55 px-2 py-1 text-[9px] font-medium text-white backdrop-blur-sm"
            initial={from({ opacity: 0, y: 8 })}
            animate={{ opacity: 1, y: 0 }}
            transition={at(1.9, 0.45)}
          >
            <WandSparkles size={10} className="shrink-0 text-accent" /> AI-suggested
          </motion.span>
          <div className="absolute inset-x-2.5 bottom-2.5 h-0.5 overflow-hidden rounded-full bg-white/20">
            <motion.div className="h-full origin-left bg-white" initial={from({ scaleX: 0 })} animate={{ scaleX: 1 }} transition={{ ...at(2.9, 1.4), ease: "linear" }} />
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-faint">Frame</p>
            <div className="grid grid-cols-3 gap-0.5 rounded-lg bg-black/30 p-0.5 ring-1 ring-white/[0.06]">
              {CROP_MODES.map((mode, i) => (
                <span
                  key={mode}
                  className={`relative rounded-md py-1.5 text-center text-[10px] font-medium transition-colors duration-300 ${cropMode === i ? "text-accent-ink" : "text-text-muted"}`}
                >
                  {cropMode === i && (
                    <motion.span
                      layoutId="clip-crop-mode"
                      className="absolute inset-0 rounded-md bg-accent"
                      transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative">{mode}</span>
                </span>
              ))}
            </div>
          </div>
          <ul className="flex flex-col gap-1.5">
            {STEPS.map(({ icon: Icon, label, delay }) => (
              <motion.li
                key={label}
                className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-[11px] text-text-muted ring-1 ring-white/[0.05]"
                initial={from({ opacity: 0, x: 10 })}
                animate={{ opacity: 1, x: 0 }}
                transition={at(delay, 0.45)}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Icon size={11} />
                </span>
                <span className="truncate">{label}</span>
              </motion.li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-xl bg-black/25 px-3 pb-2.5 pt-3 ring-1 ring-white/[0.05]">
        <div className="relative h-11">
          <div className="flex h-full items-center gap-[2px]">
            {BARS.map((height, i) => (
              <motion.span
                key={i}
                className={`flex-1 rounded-full transition-colors duration-500 ${phase >= 1 && i >= SELECT_START && i < SELECT_END ? "bg-accent" : "bg-white/15"}`}
                style={{ height: `${height}%` }}
                initial={from({ scaleY: 0.1, opacity: 0 })}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={at(0.25 + i * 0.012, 0.45)}
              />
            ))}
          </div>
          <motion.div
            className="absolute -inset-y-1 rounded-md border-2 border-accent bg-accent/10"
            initial={from({ left: "0%", width: "100%", opacity: 0 })}
            animate={{ left: selectLeft, width: selectWidth, opacity: 1 }}
            transition={at(0.8, 0.7)}
          >
            <span className="absolute -left-[5px] top-1/2 h-5 w-2 -translate-y-1/2 rounded-sm bg-accent" />
            <span className="absolute -right-[5px] top-1/2 h-5 w-2 -translate-y-1/2 rounded-sm bg-accent" />
          </motion.div>
          <motion.div
            className="absolute -inset-y-2 w-0.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.7)]"
            initial={from({ left: selectLeft, opacity: 0 })}
            animate={{ left: selectRight, opacity: 1 }}
            transition={{ ...at(2.9, 1.4), ease: "linear", opacity: at(2.9, 0.2) }}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[10px] text-text-muted">
          <span className="flex items-center gap-1.5">
            <AudioLines size={11} /> Source
          </span>
          <motion.span className="font-mono text-accent" initial={from({ opacity: 0 })} animate={{ opacity: 1 }} transition={at(1.3)}>
            {formatTimecode(SELECT_START * SECONDS_PER_BAR)} – {formatTimecode(SELECT_END * SECONDS_PER_BAR)}
          </motion.span>
          <span className="font-mono">{formatTimecode(BAR_COUNT * SECONDS_PER_BAR)}</span>
        </div>
      </div>
    </div>
  );
}

function SpeakerArt() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(165deg,#2b2540_0%,#171a24_52%,#0e1015_100%)]">
      <div className="absolute -right-8 top-6 h-28 w-28 rounded-full bg-accent/35 blur-2xl" />
      <div className="absolute -left-10 bottom-16 h-24 w-24 rounded-full bg-verified/20 blur-2xl" />
      <div className="absolute left-[18%] top-[12%] h-[30%] w-[22%] rounded-sm bg-white/[0.04] ring-1 ring-white/[0.05]" />
      <div className="absolute left-1/2 top-[33%] h-[17%] w-[34%] -translate-x-1/2 rounded-[45%] bg-gradient-to-b from-[#4a4452] to-[#2a2733]" />
      <div className="absolute bottom-0 left-1/2 h-[40%] w-[80%] -translate-x-1/2 rounded-t-[48%] bg-gradient-to-b from-[#3a3544] to-[#1a1920]" />
      <div className="absolute bottom-0 left-1/2 h-[40%] w-[80%] -translate-x-1/2 rounded-t-[48%] bg-gradient-to-r from-accent/25 via-transparent to-transparent" />
    </div>
  );
}
