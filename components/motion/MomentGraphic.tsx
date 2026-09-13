"use client";

import Image from "next/image";
import { useState } from "react";
import { motion } from "motion/react";
import { Check, Film, Play, RotateCcw, ScanSearch, Scissors } from "lucide-react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const ease = [0.16, 1, 0.3, 1] as const;
const footage = "/images/alpine-footage.svg";

function Thumbnail({ className = "", position = "center" }: { className?: string; position?: string }) {
  return <Image src={footage} alt="" fill sizes="(max-width: 640px) 70vw, 400px" className={`object-cover ${className}`} style={{ objectPosition: position }} />;
}

/** Illustrative research-to-clip sequence; never represents an active search or export. */
export function MomentGraphic() {
  const reduced = usePrefersReducedMotion();
  const [replay, setReplay] = useState(0);
  const timing = (delay: number, duration = 0.5) => ({ delay: reduced ? 0 : delay, duration: reduced ? 0 : duration, ease });

  return (
    <figure className="mx-auto mb-8 w-full max-w-xl">
      <div className="mb-2 flex h-7 items-center justify-between text-xs text-text-muted">
        <span className="flex items-center gap-1.5"><Film size={13} /> From footage to a moment</span>
        {!reduced && <button type="button" onClick={() => setReplay((value) => value + 1)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 hover:bg-surface-hover hover:text-text" aria-label="Replay research and clipping animation"><RotateCcw size={12} /> Replay</button>}
      </div>

      <div key={`${replay}-${reduced}`} aria-hidden="true" className="overflow-hidden rounded-xl border border-border-strong bg-surface shadow-[0_16px_60px_-30px_#000]">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5 text-[11px] text-text-muted sm:px-4">
          <ScanSearch size={13} className="shrink-0 text-accent" />
          <span className="truncate">Find the hiker reaching the ridge</span>
          <span className="ml-auto shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[9px]">Example</span>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_140px] sm:gap-3 sm:p-3">
          <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-surface-raised">
            <motion.div className="absolute inset-0" initial={false} animate={{ scale: reduced ? 1 : [1.06, 1.12, 1.04], x: reduced ? 0 : [0, -5, 0] }} transition={timing(0, 3.6)}>
              <Thumbnail />
            </motion.div>
            <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-transparent" />
            <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-1 text-[9px] text-white"><Play size={9} fill="currentColor" /> Alpine expedition</span>
            {!reduced && <motion.div className="absolute inset-y-0 w-10 border-r border-accent bg-gradient-to-l from-accent/25 to-transparent" initial={{ left: "-15%", opacity: 0 }} animate={{ left: ["-15%", "105%"], opacity: [0, 1, 1, 0] }} transition={{ delay: 0.3, duration: 1.4, ease: "linear" }} />}
            <motion.div style={{ borderColor: "var(--color-accent)" }} className="absolute left-[22%] top-[58%] h-[32%] w-[20%] rounded-sm border shadow-[0_0_0_1px_#0003]" initial={reduced ? false : { opacity: 0, scale: 1.2 }} animate={{ opacity: 1, scale: 1 }} transition={timing(1.4)}>
              <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-accent px-1.5 py-0.5 text-[8px] font-medium text-accent-ink">Subject found</span>
            </motion.div>
            <div className="absolute inset-x-2 bottom-2 flex items-center justify-between text-[9px] text-white/90"><span>Ridge approach</span><span className="font-mono">00:42 / 02:18</span></div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-1 text-[10px] text-text-muted"><Scissors size={11} /> Clip preview</div>
            <motion.div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-accent/60 bg-surface-raised" initial={reduced ? false : { opacity: 0.2, x: -10, scale: 0.94 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={timing(2.5, 0.65)}>
              <Thumbnail position="28% center" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center"><span className="flex h-7 w-7 items-center justify-center rounded-full border border-white/50 bg-black/20 text-white"><Play size={12} fill="currentColor" /></span></div>
              <span className="absolute bottom-2 left-2 text-[9px] text-white">The summit, in sight.</span>
            </motion.div>
            <motion.div className="flex items-center gap-1 text-[10px] text-accent" initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={timing(3.2)}><Check size={11} /> 24 sec selected</motion.div>
          </div>
        </div>

        <div className="border-t border-border px-3 pb-3 pt-2.5">
          <div className="relative">
            <div className="grid h-10 grid-cols-8 gap-0.5 overflow-hidden rounded-sm sm:h-12">
              {Array.from({ length: 8 }, (_, i) => <div key={i} className="relative overflow-hidden"><Thumbnail position={`${i * 14}% center`} className={i < 2 || i > 4 ? "brightness-50" : ""} /></div>)}
            </div>
            <motion.div style={{ borderColor: "var(--color-accent)" }} className="absolute inset-y-0 left-[30.43%] w-[17.39%] rounded-sm border-2" initial={reduced ? false : { left: "0%", width: "100%", opacity: 0 }} animate={{ left: "30.43%", width: "17.39%", opacity: 1 }} transition={timing(1.9, 0.65)}>
              <span className="absolute -left-1 top-1/2 flex h-6 w-2 -translate-y-1/2 items-center justify-center rounded-sm bg-accent"><span className="h-3 w-px bg-accent-ink/60" /></span>
              <span className="absolute -right-1 top-1/2 flex h-6 w-2 -translate-y-1/2 items-center justify-center rounded-sm bg-accent"><span className="h-3 w-px bg-accent-ink/60" /></span>
            </motion.div>
            <motion.div className="absolute -top-1 bottom-0 w-px bg-white" initial={reduced ? false : { left: "0%" }} animate={{ left: "47.82%" }} transition={timing(0.3, 2.2)}><span className="absolute -left-1 top-0 h-1.5 w-2 rounded-b-sm bg-white" /></motion.div>
          </div>
          <div className="mt-2 flex items-center justify-between text-[9px] text-text-muted"><span className="flex items-center gap-1"><Film size={10} /> Source footage</span><span className="font-mono text-accent">00:42 — 01:06</span><span className="font-mono">02:18</span></div>
        </div>
      </div>
      <figcaption className="sr-only">An illustrated video research example: scan mountain footage, locate a hiker, and trim a 24-second selection into a clip preview.</figcaption>
    </figure>
  );
}
