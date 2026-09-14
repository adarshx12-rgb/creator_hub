"use client";

import { useSyncExternalStore } from "react";
import { MOTION_PREFERENCE_KEY } from "./constants";

/** "system" follows the OS reduced-motion setting; "full" is an explicit in-app opt-in to animations. */
export type MotionPreference = "system" | "full";

const QUERY = "(prefers-reduced-motion: reduce)";
const CHANGE_EVENT = "momentscout:motion-change";
let cachedPreference: MotionPreference | null = null;

function readPreference(): MotionPreference {
  if (cachedPreference === null) {
    try {
      cachedPreference = window.localStorage.getItem(MOTION_PREFERENCE_KEY) === "full" ? "full" : "system";
    } catch {
      cachedPreference = "system";
    }
  }
  return cachedPreference;
}

// globals.css only lifts its CSS transition kill-switch when <html data-motion="full"> is present.
function applyPreference(preference: MotionPreference) {
  if (preference === "full") document.documentElement.dataset.motion = "full";
  else delete document.documentElement.dataset.motion;
}

function subscribe(onChange: () => void) {
  applyPreference(readPreference());
  const media = window.matchMedia(QUERY);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MOTION_PREFERENCE_KEY) return;
    cachedPreference = null;
    applyPreference(readPreference());
    onChange();
  };
  media.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function setMotionPreference(preference: MotionPreference) {
  cachedPreference = preference;
  try {
    if (preference === "full") window.localStorage.setItem(MOTION_PREFERENCE_KEY, "full");
    else window.localStorage.removeItem(MOTION_PREFERENCE_KEY);
  } catch {
    // Storage may be blocked; the choice still applies until the page reloads.
  }
  applyPreference(preference);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * motion/react's own useReducedMotion() reads matchMedia during render, which disagrees with the
 * server on the first client render and causes a hydration mismatch. The server snapshots here match
 * SSR ("not reduced"), and React switches to the real values right after hydration.
 */
export function useMotionSettings() {
  const systemReduced = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  const preference = useSyncExternalStore(subscribe, readPreference, (): MotionPreference => "system");
  return { systemReduced, preference, reduced: systemReduced && preference !== "full" };
}

export function usePrefersReducedMotion(): boolean {
  return useMotionSettings().reduced;
}
