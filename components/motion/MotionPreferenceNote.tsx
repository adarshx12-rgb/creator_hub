"use client";

import { Sparkles } from "lucide-react";
import { setMotionPreference, useMotionSettings } from "@/lib/use-prefers-reduced-motion";

/** Only shown when the OS asks for reduced motion, so overriding it is always an explicit choice. */
export function MotionPreferenceNote() {
  const { systemReduced, preference } = useMotionSettings();
  if (!systemReduced) return null;
  const animationsOn = preference === "full";

  return (
    <p className="mt-1 flex flex-wrap items-center justify-center gap-x-1 text-center text-[11px] text-text-faint">
      {animationsOn ? "Animations are on for this site." : "Your device asks for reduced motion, so cards fade instead of rotating."}
      <button
        type="button"
        onClick={() => setMotionPreference(animationsOn ? "system" : "full")}
        className="inline-flex min-h-8 items-center gap-1 rounded px-1.5 font-medium text-accent transition-colors hover:text-accent-strong"
      >
        <Sparkles size={11} /> {animationsOn ? "Use device setting" : "Turn on animations"}
      </button>
    </p>
  );
}
