import { PRODUCT_NAME } from "@/lib/constants";

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0">
        <rect x="1" y="1" width="24" height="24" rx="7" stroke="var(--color-accent)" strokeWidth="1.5" />
        <path d="M10.5 8.5L17 13L10.5 17.5V8.5Z" fill="var(--color-accent)" />
      </svg>
      {!compact && (
        <span className="font-display text-[1.05rem] font-medium tracking-tight text-text">
          {PRODUCT_NAME}
        </span>
      )}
    </div>
  );
}
