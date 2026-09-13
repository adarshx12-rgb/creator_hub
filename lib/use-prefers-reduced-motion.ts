"use client";

import { useEffect, useState } from "react";

/**
 * motion/react's own useReducedMotion() reads matchMedia synchronously during
 * render, which disagrees with the server's default on the very first client
 * render and causes a hydration mismatch. This version always starts `false`
 * (matching SSR) and picks up the real preference right after mount, which is
 * a plain client-side update rather than a hydration diff.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Deliberately deferred to after mount - matchMedia isn't available during SSR,
    // and reading it during render (as motion/react's own hook does) is exactly
    // what caused the hydration mismatch this hook exists to avoid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(query.matches);
    const listener = (e: MediaQueryListEvent) => setReduced(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return reduced;
}
