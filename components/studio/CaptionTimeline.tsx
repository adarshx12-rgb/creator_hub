"use client";

import { useRef, useState, type PointerEvent } from 'react';
import { adjustCaption, splitCaption, validateCues, type CaptionCue } from '@/lib/captions';
import { Button } from '@/components/ui/Button';

type Mode = 'move' | 'start' | 'end';
interface Props { selected: number; onSelect: (index: number) => void; cues: CaptionCue[]; duration: number; time: number; onChange: (cues: CaptionCue[]) => void; onSeek: (time: number) => void; onPause: () => void }
export function CaptionTimeline({ selected, onSelect: setSelected, cues, duration, time, onChange, onSeek, onPause }: Props) {
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<CaptionCue[][]>([]);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; mode: Mode; x: number; width: number; original: CaptionCue[] } | null>(null);
  const cue = cues[selected];
  const invalid = !!validateCues(cues, duration);
  const save = () => setHistory(previous => [...previous.slice(-49), cues.map(c => ({ ...c }))]);
  function commit(next: CaptionCue[]) { if (next === cues) return; save(); onChange(next); }
  function begin(event: PointerEvent<HTMLButtonElement>, index: number, mode: Mode) {
    if (invalid || duration <= 0) return;
    event.preventDefault(); event.stopPropagation(); onPause(); setSelected(index); save();
    drag.current = { index, mode, x: event.clientX, width: track.current!.getBoundingClientRect().width, original: cues };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSeek(cues[index].start);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active) return;
    const next = adjustCaption(active.original, active.index, active.mode, (event.clientX - active.x) / active.width * duration, duration);
    onChange(next);
    onSeek(active.mode === 'end' ? Math.max(next[active.index].start, next[active.index].end - .01) : next[active.index].start);
  }
  function keyboard(event: React.KeyboardEvent, index: number, mode: Mode) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); onPause(); setSelected(index);
    commit(adjustCaption(cues, index, mode, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : .1), duration));
  }
  const tickCount = Math.min(100, Math.max(5, Math.ceil(zoom * 5)));
  const canSplit = cue && time - cue.start >= .2 && cue.end - time >= .2;
  function add() {
    if (invalid || duration <= 0 || cues.some(c => time >= c.start && time < c.end)) return;
    const nextStart = cues.find(c => c.start > time)?.start ?? duration;
    if (nextStart - time < .2) return;
    const next = [...cues, { start: time, end: Math.min(time + 2, nextStart), text: 'Your caption' }].sort((a,b) => a.start - b.start);
    commit(next); setSelected(next.findIndex(c => c.start === time)); onPause();
  }
  return <section aria-label="Caption timeline" className="rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-medium">Caption timeline</h2><span className="text-xs tabular-nums text-text-muted">{time.toFixed(2)} / {duration.toFixed(2)}s</span></div>
    <div className="my-3 flex flex-wrap gap-2">
      <Button size="sm" disabled={!canSplit || invalid} onClick={() => commit(splitCaption(cues, selected, time))}>Split at playhead</Button>
      <Button size="sm" disabled={!cue} onClick={() => { commit(cues.filter((_, i) => i !== selected)); setSelected(-1); }}>Delete caption</Button>
      <Button size="sm" disabled={invalid || duration - time < .2 || cues.some(c => time >= c.start && time < c.end)} onClick={add}>Add at playhead</Button>
      <Button size="sm" disabled={!cues.length} onClick={() => { commit([]); setSelected(-1); }}>Clear captions</Button>
      <Button size="sm" disabled={!history.length} onClick={() => { onChange(history[history.length - 1]); setHistory(history.slice(0, -1)); setSelected(-1); }}>Undo</Button>
    </div>
    <p className="mb-3 text-xs text-text-muted">Drag a clip to move it; drag its edges to trim. Click the ruler to seek. These edits affect captions only.</p>
    <label className="mb-3 flex items-center gap-3 text-xs text-text-muted">Zoom<input aria-label="Timeline zoom" type="range" min="1" max="20" step="1" value={zoom} onChange={e => setZoom(Number(e.target.value))} className="accent-accent" /><span>{zoom}x</span></label>
    <div className="overflow-x-auto rounded border border-border bg-bg">
      <div ref={track} className="relative min-w-full" style={{ width: `${zoom * 100}%` }}>
        <div role="slider" tabIndex={0} aria-label="Caption timeline playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} className="relative h-9 cursor-crosshair border-b border-border" onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; const rect = track.current!.getBoundingClientRect(); onSeek(Math.max(0, Math.min(duration, (e.clientX - rect.left) / rect.width * duration))); }} onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); const rect = track.current!.getBoundingClientRect(); onPause(); onSeek(Math.max(0, Math.min(duration, (e.clientX - rect.left) / rect.width * duration))); }} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onPause(); onSeek(Math.max(0, Math.min(duration, time + (e.key === 'ArrowLeft' ? -.1 : .1)))); } }}>
          {Array.from({ length: tickCount + 1 }, (_, i) => <span key={i} className="pointer-events-none absolute bottom-1 border-l border-border pl-1 text-[10px] text-text-faint" style={{ left: `${i / tickCount * 100}%`, transform: i === tickCount ? 'translateX(-100%)' : undefined }}>{(duration * i / tickCount).toFixed(1)}s</span>)}
        </div>
        <div className="relative h-20" aria-label="Caption clips">
          {cues.map((item, index) => <div key={index} className={`absolute top-3 flex h-12 overflow-hidden rounded border ${selected === index ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-border-strong bg-surface-raised'}`} style={{ left: `${duration ? item.start / duration * 100 : 0}%`, width: `${duration ? (item.end - item.start) / duration * 100 : 0}%` }}>
            {(['start', 'move', 'end'] as const).map(mode => <button key={mode} type="button" aria-label={`${mode === 'move' ? 'Move' : 'Trim ' + mode + ' of'} caption ${index + 1}`} title={`${item.start.toFixed(2)}?${item.end.toFixed(2)}s: ${item.text}`} className={mode === 'move' ? 'min-w-0 flex-1 cursor-grab touch-none truncate px-1 text-left text-xs active:cursor-grabbing' : 'w-2 shrink-0 cursor-ew-resize touch-none bg-accent/40'} onFocus={() => { setSelected(index); onPause(); onSeek(item.start); }} onPointerDown={e => begin(e, index, mode)} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { const active = drag.current; if (active) onChange(active.original); drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={e => keyboard(e, index, mode)}>{mode === 'move' ? item.text : ''}</button>)}
          </div>)}
          {!cues.length && <p className="p-5 text-xs text-text-muted">Generate captions or add one at the playhead to begin.</p>}
        </div>
        <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent" style={{ left: `${duration ? time / duration * 100 : 0}%` }} />
      </div>
    </div>
    {cue && <div className="mt-3 space-y-2"><label className="block text-xs text-text-muted">Selected caption<textarea aria-label="Selected caption text" className="mt-1 w-full rounded border border-border-strong bg-bg p-2 text-sm text-text" value={cue.text} maxLength={500} onFocus={save} onChange={e => onChange(cues.map((c, i) => i === selected ? { ...c, text: e.target.value } : c))} /></label><div className="flex gap-3">{(['start', 'end'] as const).map(edge => <label key={edge} className="min-w-0 flex-1 text-xs text-text-muted">{edge === 'start' ? 'Start' : 'End'} (seconds)<input type="number" step=".1" min="0" max={duration} value={cue[edge]} className="mt-1 w-full rounded border border-border-strong bg-bg p-2 text-text" onChange={e => { if (e.target.value !== '') commit(adjustCaption(cues, selected, edge, Number(e.target.value) - cue[edge], duration)); }} /></label>)}</div><p className="text-xs text-text-faint">Splitting divides words approximately; review each half after cutting.</p></div>}
    {invalid && <p role="alert" className="mt-2 text-xs text-danger">{validateCues(cues, duration)}</p>}
  </section>;
}
