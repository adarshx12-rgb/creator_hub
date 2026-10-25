"use client";

import { useEffect, useRef, useState } from 'react';
import { resolveCaptionDesign, captionTextColor, isDifferenceBlend, activeCueIndex, captionPresets, clipCues, defaultCaptionDesign, normalizeCues, subtitles, validateCues, type CaptionCue, type CaptionDesign } from '@/lib/captions';
import { Button } from '@/components/ui/Button';

export function CaptionText({ text, design }: { text: string; design: CaptionDesign }) {
  const preset = captionPresets.find(p => p.id === design.preset) ?? captionPresets[0];
  const color = captionTextColor(design);
  const shadow = '0 0.04em 0.08em rgba(0, 0, 0, 0.6)';
  return <span style={{ fontFamily: preset.local ? `"${preset.font}", sans-serif` : `var(--caption-${preset.id}), sans-serif`, fontWeight: preset.weight, fontStyle: preset.italic ? 'italic' : 'normal', color, textShadow: design.glow ? `${shadow}, 0 0 0.12em ${color}, 0 0 0.28em ${color}` : shadow, WebkitTextStroke: '0.025em rgba(0, 0, 0, 0.8)', paintOrder: 'stroke fill', background: design.background ? `${design.backgroundColor ?? '#000000'}${Math.round((design.backgroundOpacity ?? .75) * 255).toString(16).padStart(2, '0')}` : undefined, padding: design.background ? `${design.backgroundPadding ?? .2}em` : undefined, borderRadius: design.background ? `${design.backgroundRadius ?? .15}em` : undefined, boxDecorationBreak: 'clone', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</span>;
}

export function CaptionOverlay({ cues, design: baseDesign, time, onDesign, onSelect }: { cues: CaptionCue[]; design: CaptionDesign; time: number; onDesign?: (index: number, design: CaptionDesign) => void; onSelect?: (index: number) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; width: number; height: number; halfWidth: number; halfHeight: number } | null>(null);
  const index = activeCueIndex(cues, time);
  const cue = cues[index];
  const design = resolveCaptionDesign(cue, baseDesign);
  if (!cue) return null;
  const x = design.x ?? 50;
  const y = design.y ?? ({ top: 15, middle: 50, bottom: 85 }[design.position]);
  // The blend goes on this outer layer: container-type creates an isolated group, so blending any deeper
  // would only mix with this transparent layer instead of the video beneath it.
  return <div ref={container} className="pointer-events-none absolute inset-0" style={{ containerType: 'inline-size', mixBlendMode: isDifferenceBlend(design) ? 'difference' : undefined }}>
    <div role={onDesign ? 'button' : undefined} tabIndex={onDesign ? 0 : undefined} aria-label={onDesign ? 'Drag caption to reposition; arrow keys move caption' : undefined}
      className={onDesign ? 'pointer-events-auto w-max max-w-[86%] cursor-move touch-none rounded outline-offset-4 hover:outline hover:outline-accent focus-visible:outline' : 'w-max max-w-[86%]'}
      style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)', textAlign: 'center', lineHeight: 1.3, fontSize: `${design.size}cqw`, padding: design.background ? `${design.backgroundPadding ?? .2}em` : undefined }}
      onPointerDown={e => { if (!onDesign || !container.current) return; e.preventDefault(); e.stopPropagation(); onSelect?.(index); const rect = container.current.getBoundingClientRect(); const bounds = e.currentTarget.getBoundingClientRect(); drag.current = { x, y, startX: e.clientX, startY: e.clientY, width: rect.width, height: rect.height, halfWidth: Math.min(50, bounds.width / rect.width * 50), halfHeight: Math.min(50, bounds.height / rect.height * 50) }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { const d = drag.current; if (!d || !onDesign) return; e.stopPropagation(); onDesign(index, { ...design, x: Math.max(d.halfWidth, Math.min(100 - d.halfWidth, d.x + (e.clientX - d.startX) / d.width * 100)), y: Math.max(d.halfHeight, Math.min(100 - d.halfHeight, d.y + (e.clientY - d.startY) / d.height * 100)) }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={e => { if (!onDesign || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); onSelect?.(index); const step = e.shiftKey ? 5 : 1; onDesign(index, { ...design, x: Math.max(5, Math.min(95, x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0))), y: Math.max(5, Math.min(95, y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0))) }); }}>
      <CaptionText text={cue.text} design={design} />
    </div>
  </div>;
}

interface Props { onFontLoaded: (preset: string, file: File) => void; selectedCaption: number; baseDesign: CaptionDesign; currentTime: number; objectUrl: string; fileName: string; duration: number; start: number; end: number; crop: string; frame?: { width: number; height: number }; cues: CaptionCue[]; design: CaptionDesign; onCues: (cues: CaptionCue[]) => void; onDesign: (design: CaptionDesign) => void; onSeek: (time: number) => void }
export function CaptionEditor({ onFontLoaded, selectedCaption, baseDesign, objectUrl, fileName, duration, start, end, crop, frame, cues, design, onCues, onDesign }: Props) {
  const [language, setLanguage] = useState<'english' | 'hinglish'>('hinglish');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const uploadedFonts = useRef<FontFace[]>([]);
  useEffect(() => () => { uploadedFonts.current.forEach(font => document.fonts.delete(font)); }, []);
  async function loadFont(file: File) {
    const preset = captionPresets.find(p => p.id === design.preset) ?? captionPresets[0];
    try {
      const font = new FontFace(preset.font, await file.arrayBuffer(), { weight: String(preset.weight) });
      await font.load();
      uploadedFonts.current.filter(previous => previous.family === preset.font).forEach(previous => document.fonts.delete(previous));
      uploadedFonts.current = uploadedFonts.current.filter(previous => previous.family !== preset.font);
      document.fonts.add(font);
      uploadedFonts.current.push(font);
      onFontLoaded(preset.id, file);
      setMessage(`${preset.font} loaded for this editing session. This font file will also be sent with MP4 exports.`);
    } catch { setMessage('Could not load this font. Choose a valid WOFF2, WOFF, TTF, or OTF file.'); }
  }
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const error = validateCues(cues, duration || Infinity);
  const clipped = clipCues(cues, start, end);
  async function generate() {
    setBusy(true); setMessage('');
    controller.current = new AbortController();
    const signal = controller.current.signal;
    try {
      const source = await fetch(objectUrl, { signal });
      const blob = await source.blob();
      const response = await fetch('/api/captions', { method: 'POST', headers: { 'Content-Type': blob.type, 'X-Caption-Language': language }, body: blob, signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not generate captions.');
      // The server already repairs timings against the probed duration; repeat against the player's duration.
      const generated = normalizeCues(data.cues, duration);
      onCues(generated);
      setMessage(data.noAudio ? 'This video has no audio track. You can add captions manually.'
        : !generated.length ? 'No audible speech was found. You can add captions manually.'
        : `Captions generated. Review the words and timing before exporting.${data.dropped ? ` ${data.dropped} unusable cue${data.dropped === 1 ? ' was' : 's were'} skipped.` : ''}`);
    } catch (err) {
      if (!signal.aborted) setMessage(err instanceof Error ? err.message : 'Could not generate captions.');
    } finally { if (!signal.aborted) setBusy(false); }
  }
  function cancel() {
    controller.current?.abort();
    setBusy(false);
    setMessage('Caption generation cancelled.');
  }
  function download(format: 'srt' | 'vtt' | 'ass') {
    const url = URL.createObjectURL(new Blob([subtitles(clipped, format, baseDesign, crop, frame)], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${fileName.replace(/\.[^.]+$/, '')}-captions.${format}`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const selectedFont = captionPresets.find(p => p.id === design.preset) ?? captionPresets[0];
  const selectedPreset = selectedFont.id;
  const field = 'w-full rounded-md border border-border-strong bg-bg px-2 py-1.5 text-xs text-text';
  return <section className="rounded-lg border border-border bg-surface p-4" aria-label="Caption editor">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-medium">Captions</h2><p className="mt-1 text-xs text-text-muted">Give every word its own place.</p></div><div className="flex gap-2">{busy && <Button size="sm" variant="ghost" onClick={cancel}>Cancel</Button>}<Button size="sm" onClick={generate} disabled={busy || cues.length > 0 || duration <= 0}>{busy ? 'Transcribing…' : 'Generate captions'}</Button></div></div>
    <label className="mt-4 block text-xs text-text-muted">Caption language<select disabled={busy} value={language} onChange={e => setLanguage(e.target.value as typeof language)} className={`${field} mt-1`}><option value="hinglish">Hinglish (Hindi in English letters)</option><option value="english">English (translate Hindi)</option></select></label><p className="mt-2 text-xs text-text-muted">Hindi, English, and mixed audio supported. Hinglish keeps English speech and writes Hindi in Latin letters.</p>
    <p className="mt-3 text-xs leading-relaxed text-text-muted">Generate sends the audio of this video to Gemini for transcription (videos up to 30 minutes). Or add captions manually. Clear existing captions to generate again.</p>
    {message && <p role="status" className="mt-3 text-xs text-accent-strong">{message}</p>}
    <p role="status" className="mt-4 rounded-md bg-accent-soft p-3 text-xs text-accent-strong">{selectedCaption >= 0 ? `Editing caption ${selectedCaption + 1} only` : 'Select a caption clip in the timeline to change its appearance.'}</p>
    <fieldset className="mt-5" disabled={busy || selectedCaption < 0}><legend className="mb-2 text-xs text-text-muted">Caption font</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{captionPresets.map(p => <button key={p.id} type="button" aria-pressed={selectedPreset === p.id} onClick={() => onDesign({ ...design, preset: p.id })} className={`overflow-hidden rounded-md border p-3 text-center ${selectedPreset === p.id ? 'border-accent bg-accent-soft' : 'border-border-strong bg-bg'}`}><div className="flex h-12 items-center justify-center text-lg"><CaptionText text="Make it count" design={{ ...defaultCaptionDesign, preset: p.id, color: design.color }} /></div><span className="mt-2 block text-xs text-text-muted">{p.font}</span></button>)}</div>
    {selectedFont.local && <div className="mt-3 text-xs text-text-muted"><p>{selectedFont.font} requires the font installed on your device or a font file. Otherwise, the preview uses a fallback.</p><label className="mt-2 block">Load {selectedFont.font} font file<input key={selectedFont.id} type="file" accept=".woff2,.woff,.ttf,.otf" className="mt-2 block w-full text-xs" onChange={event => { const file = event.target.files?.[0]; if (file) void loadFont(file); }} /></label></div>}
    <div className="mt-4 grid grid-cols-3 gap-3"><label className="text-xs text-text-muted">Size<input aria-label="Caption font size" type="range" min="3" max="10" step="0.5" value={design.size} onChange={e => onDesign({ ...design, size: Number(e.target.value) })} className="mt-3 w-full accent-accent" /></label><label className="text-xs text-text-muted">Color<input type="color" value={design.color} onChange={e => onDesign({ ...design, color: e.target.value })} className="mt-1 block h-8 w-full cursor-pointer" /></label><label className="text-xs text-text-muted">Position<select value={design.position} onChange={e => onDesign({ ...design, position: e.target.value as CaptionDesign['position'], x: undefined, y: undefined })} className={`${field} mt-1`}><option value="bottom">Bottom</option><option value="middle">Middle</option><option value="top">Top</option></select></label></div>
    <fieldset className="mt-5 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Effects</legend>
      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={design.glow ?? false} onChange={e => onDesign({ ...design, glow: e.target.checked })} className="mt-1 accent-accent" /><span><span className="block text-xs font-medium">Glow</span><span className="mt-1 block text-xs text-text-muted">Add a soft halo in the text color.</span></span></label>
        <label className="flex cursor-pointer items-start gap-3"><input type="checkbox" checked={design.inverted ?? false} onChange={e => onDesign({ ...design, inverted: e.target.checked })} className="mt-1 accent-accent" /><span><span className="block text-xs font-medium">Inverted (difference blend)</span><span className="mt-1 block text-xs text-text-muted">Text inverts the video behind it. White gives a true invert; other colors tint it. Outlines and shadows disappear.</span></span></label>
      </div>
      <div className="mt-3 rounded-md bg-[#737373] px-3 py-4 text-center text-xl" aria-label="Caption effects preview"><CaptionText text="Make it count" design={design} /></div>
    </fieldset>
    <fieldset className="mt-5 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Background box</legend>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={design.background ?? false} onChange={e => onDesign({ ...design, background: e.target.checked })} className="accent-accent" />Show background box</label>
      {design.background && <div className="mt-3 space-y-3">
        <label className="block text-xs text-text-muted">Box color<input aria-label="Caption background color" type="color" value={design.backgroundColor ?? '#000000'} onChange={e => onDesign({ ...design, backgroundColor: e.target.value })} className="mt-1 block h-8 w-full" /></label>
        <label className="block text-xs text-text-muted">Opacity {Math.round((design.backgroundOpacity ?? .75) * 100)}%<input aria-label="Caption background opacity" type="range" min="0" max="1" step=".05" value={design.backgroundOpacity ?? .75} onChange={e => onDesign({ ...design, backgroundOpacity: Number(e.target.value) })} className="mt-2 w-full accent-accent" /></label>
        <label className="block text-xs text-text-muted">Padding<input aria-label="Caption background padding" type="range" min="0" max=".6" step=".05" value={design.backgroundPadding ?? .2} onChange={e => onDesign({ ...design, backgroundPadding: Number(e.target.value) })} className="mt-2 w-full accent-accent" /></label>
        <label className="block text-xs text-text-muted">Roundness<input aria-label="Caption background roundness" type="range" min="0" max=".5" step=".05" value={design.backgroundRadius ?? .15} onChange={e => onDesign({ ...design, backgroundRadius: Number(e.target.value) })} className="mt-2 w-full accent-accent" /></label>
      </div>}
    </fieldset>
    <fieldset className="mt-5 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">Caption position</legend>
      <p className="text-xs text-text-muted">Drag the caption in the video or adjust its position here. Applies only to the selected caption.</p>
      <label className="mt-3 block text-xs text-text-muted">Horizontal<input aria-label="Caption horizontal position" type="range" min="5" max="95" value={design.x ?? 50} onChange={e => onDesign({ ...design, x: Number(e.target.value) })} className="mt-2 w-full accent-accent" /></label>
      <label className="mt-3 block text-xs text-text-muted">Vertical<input aria-label="Caption vertical position" type="range" min="5" max="95" value={design.y ?? ({ top: 15, middle: 50, bottom: 85 }[design.position])} onChange={e => onDesign({ ...design, y: Number(e.target.value) })} className="mt-2 w-full accent-accent" /></label>
      <Button size="sm" variant="ghost" className="mt-2" onClick={() => onDesign({ ...design, x: undefined, y: undefined })}>Reset position</Button>
    </fieldset>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-2">{(['srt', 'vtt', 'ass'] as const).map(format => <Button key={format} variant="secondary" size="sm" disabled={!!error || !clipped.length || busy} onClick={() => download(format)}>Download {format.toUpperCase()}</Button>)}</div><p className="mt-2 text-xs leading-relaxed text-text-muted">Downloads use your trim selection. SRT and VTT contain text and timing; ASS includes effects, position, and a rectangular background box; rounded corners are preview-only. Use Export MP4 below to burn captions into the video.</p>
  </section>;
}
