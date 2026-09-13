"use client";

import { Chip } from "@/components/ui/Chip";
import type { Provider, SortOrder } from "@/lib/types";

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "date", label: "Newest" },
  { value: "viewCount", label: "Most viewed" },
];

export type DurationFilter = "any" | "short" | "medium" | "long";

const DURATION_OPTIONS: { value: DurationFilter; label: string }[] = [
  { value: "any", label: "Any length" },
  { value: "short", label: "Under 4 min" },
  { value: "medium", label: "4-20 min" },
  { value: "long", label: "Over 20 min" },
];

const SOURCE_OPTIONS: { value: Provider; label: string }[] = [
  { value: "youtube", label: "YouTube" },
  { value: "twitch", label: "Twitch" },
];

interface FilterBarProps {
  order: SortOrder;
  onOrderChange: (order: SortOrder) => void;
  duration: DurationFilter;
  onDurationChange: (duration: DurationFilter) => void;
  sources: Provider[];
  onSourcesChange: (sources: Provider[]) => void;
}

export function FilterBar({
  order,
  onOrderChange,
  duration,
  onDurationChange,
  sources,
  onSourcesChange,
}: FilterBarProps) {
  function toggleSource(value: Provider) {
    const next = sources.includes(value) ? sources.filter((s) => s !== value) : [...sources, value];
    // Never let the filter empty out entirely - fall back to "all sources" instead of a dead-end.
    onSourcesChange(next.length === 0 ? SOURCE_OPTIONS.map((o) => o.value) : next);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-text-faint">Sort</span>
        {SORT_OPTIONS.map((opt) => (
          <Chip key={opt.value} active={order === opt.value} onClick={() => onOrderChange(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-text-faint">Duration</span>
        {DURATION_OPTIONS.map((opt) => (
          <Chip key={opt.value} active={duration === opt.value} onClick={() => onDurationChange(opt.value)}>
            {opt.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-text-faint">Source</span>
        {SOURCE_OPTIONS.map((opt) => (
          <Chip key={opt.value} active={sources.includes(opt.value)} onClick={() => toggleSource(opt.value)}>
            {opt.label}
          </Chip>
        ))}
        <Chip active={false} disabled className="cursor-default opacity-60" title="No official discovery API yet">
          Kick (soon)
        </Chip>
      </div>
    </div>
  );
}
