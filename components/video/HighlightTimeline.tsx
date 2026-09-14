"use client";

import type { Highlight } from "@/lib/analysis/shared";
import { formatTimecode } from "@/lib/format";

export function HighlightTimeline({ duration, currentTime, highlights, selection, ready, onSeek, onSelect }: {
  duration: number; currentTime: number; highlights: Highlight[];
  selection: { startSeconds: number; endSeconds: number } | null;
  ready: boolean; onSeek: (time: number) => void; onSelect: (highlight: Highlight) => void;
}) {
  if (duration <= 0) return null;
  const percent = (time: number) => `${Math.max(0, Math.min(100, time / duration * 100))}%`;
  // Overlapping moments get separate rows so no suggestion hides another.
  const lanes: Highlight[][] = [];
  for (const item of [...highlights].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const lane = lanes.find((row) => row[row.length - 1].endSeconds <= item.startSeconds);
    if (lane) lane.push(item); else lanes.push([item]);
  }
  return (
    <div className="mb-5 border-b border-border pb-4" aria-label="Video highlight timeline">
      <div className="mb-2 flex justify-between gap-3 text-xs">
        <span className="font-medium">Choose a raw clip</span>
        <span className="font-mono text-text-muted">{formatTimecode(currentTime)} / {formatTimecode(duration)}</span>
      </div>
      <input type="range" min={0} max={duration} step={0.1} value={Math.min(duration, currentTime)}
        onChange={(event) => onSeek(event.target.valueAsNumber)} disabled={!ready}
        aria-label="Video playback position" aria-valuetext={formatTimecode(currentTime)} className="block h-5 w-full cursor-pointer accent-accent disabled:cursor-wait" />
      <div className="relative mt-1 overflow-hidden rounded bg-bg" style={{ minHeight: 32, height: Math.max(1, lanes.length) * 32 }}>
        {selection && <div className="pointer-events-none absolute inset-y-0 border-x-2 border-text bg-text/10"
          style={{ left: percent(selection.startSeconds), width: percent(selection.endSeconds - selection.startSeconds) }} />}
        {lanes.map((lane, row) => lane.map((item, index) => (
          <button key={`${row}-${index}`} type="button" onClick={() => onSelect(item)}
            aria-label={`${item.strength === "high" ? "Key" : "Potential"} moment: ${item.title}, ${formatTimecode(item.startSeconds)} to ${formatTimecode(item.endSeconds)}`}
            aria-pressed={selection?.startSeconds === item.startSeconds && selection.endSeconds === item.endSeconds}
            title={`${item.title} · ${formatTimecode(item.startSeconds)}–${formatTimecode(item.endSeconds)}`}
            className={`absolute h-7 min-w-1 rounded-sm border border-bg focus-visible:z-20 focus-visible:outline-2 focus-visible:outline-text ${item.strength === "high" ? "bg-accent" : item.strength === "medium" ? "bg-sky-400/75" : "bg-text-faint/60"}`}
            style={{ top: row * 32 + 2, left: percent(item.startSeconds), width: percent(item.endSeconds - item.startSeconds) }} />
        )))}
        <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-text" style={{ left: percent(currentTime) }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-text-muted">
        <span>0:00</span><span>{formatTimecode(duration)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted"><span><span className="text-accent">●</span> Key moments</span><span><span className="text-sky-400">●</span> Potential moments</span><span><span className="text-text-faint">●</span> Lower potential</span></div>
      <p className="mt-2 text-[11px] text-text-muted">{highlights.length ? "Select a colored highlight to preview and adjust its start and end." : "Highlights appear here as sections finish analysis."}</p>
    </div>
  );
}
