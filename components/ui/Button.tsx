"use client";

import { motion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-40",
  secondary:
    "bg-transparent text-text border border-border-strong hover:bg-surface-hover disabled:opacity-40",
  ghost: "bg-transparent text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-40",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10 disabled:opacity-40",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
};

type NativeButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onDrag" | "onDragStart" | "onDragEnd" | "onAnimationStart" | "onAnimationEnd" | "onAnimationIteration"
>;

interface ButtonProps extends NativeButtonProps {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.97 }}
      transition={{ duration: 0.12 }}
      disabled={disabled}
      className={`inline-flex select-none items-center justify-center rounded-md font-medium transition-colors ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
}
