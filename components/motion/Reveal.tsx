"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.04 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export function RevealGroup({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = usePrefersReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div initial="hidden" animate="show" variants={container} className={className}>
      {children}
    </motion.div>
  );
}

export function RevealItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = usePrefersReducedMotion();
  if (reduceMotion) return <div className={className}>{children}</div>;
  return (
    <motion.div variants={item} className={className}>
      {children}
    </motion.div>
  );
}
