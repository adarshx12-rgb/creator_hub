"use client";

import { X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onDrag" | "onAnimationStart" | "onAnimationEnd"> {
  active?: boolean;
  onRemove?: () => void;
  icon?: ReactNode;
}

export function Chip({ active = false, onRemove, icon, className = "", children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
        active
          ? "border-accent/50 bg-accent-soft text-accent-strong"
          : "border-border-strong text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text"
      } ${className}`}
      {...rest}
    >
      {icon}
      <span>{children}</span>
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-surface-hover"
        >
          <X size={11} />
        </span>
      )}
    </button>
  );
}
