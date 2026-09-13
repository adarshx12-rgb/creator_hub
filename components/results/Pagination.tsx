import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function Pagination({ page, hasPrev, hasNext, onPrev, onNext }: PaginationProps) {
  if (!hasPrev && !hasNext) return null;
  return (
    <div className="mt-8 flex items-center justify-center gap-4">
      <button
        type="button"
        disabled={!hasPrev}
        onClick={onPrev}
        className="flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ChevronLeft size={14} /> Previous
      </button>
      <span className="font-mono text-xs tabular-nums text-text-faint">Page {page}</span>
      <button
        type="button"
        disabled={!hasNext}
        onClick={onNext}
        className="flex items-center gap-1 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
      >
        Next <ChevronRight size={14} />
      </button>
    </div>
  );
}
