export interface CaptionCue { start: number; end: number; text: string; design?: CaptionDesign }
export interface CaptionDesign { preset: string; size: number; color: string; position: 'top' | 'middle' | 'bottom'; glow?: boolean; inverted?: boolean; x?: number; y?: number; background?: boolean; backgroundColor?: string; backgroundOpacity?: number; backgroundPadding?: number; backgroundRadius?: number }
export const captionPresets = [
  { id: 'montserrat', name: 'Montserrat', font: 'Montserrat', weight: 800, italic: false, outline: 2, box: false, local: false },
  { id: 'integral-cf', name: 'Integral CF', font: 'Integral CF', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'poppins', name: 'Poppins', font: 'Poppins', weight: 700, italic: false, outline: 2, box: false, local: false },
  { id: 'helvetica', name: 'Helvetica', font: 'Helvetica', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'inter', name: 'Inter', font: 'Inter', weight: 700, italic: false, outline: 2, box: false, local: false },
  { id: 'couture', name: 'Couture', font: 'Couture', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'thunder', name: 'Thunder', font: 'Thunder', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'lemon-milk', name: 'Lemon Milk', font: 'Lemon Milk', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'gerbil', name: 'Gerbil', font: 'Gerbil', weight: 400, italic: false, outline: 2, box: false, local: true },
  { id: 'abril-fatface', name: 'Abril Fatface', font: 'Abril Fatface', weight: 400, italic: false, outline: 2, box: false, local: false },
  { id: 'nofex', name: 'Nofex', font: 'Nofex', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'switzer', name: 'Switzer', font: 'Switzer', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'moonscape', name: 'Moonscape', font: 'Moonscape', weight: 700, italic: false, outline: 2, box: false, local: true },
  { id: 'bootzy', name: 'Bootzy', font: 'Bootzy', weight: 700, italic: false, outline: 2, box: false, local: true },
] as const;
export const defaultCaptionDesign: CaptionDesign = { preset: 'montserrat', size: 6, color: '#ffffff', position: 'bottom', glow: false, inverted: false };
export function resolveCaptionDesign(cue: CaptionCue | undefined, fallback: CaptionDesign): CaptionDesign {
  return cue?.design ?? fallback;
}

export function styleCaption(cues: CaptionCue[], index: number, design: CaptionDesign): CaptionCue[] {
  return cues.map((cue, i) => i === index ? { ...cue, design: { ...design } } : cue);
}
export function captionTextColor(design: CaptionDesign): string {
  return /^#[0-9a-f]{6}$/i.test(design.color) ? design.color : '#ffffff';
}
/**
 * "Inverted" captions use a difference blend: each pixel becomes |video - caption color|, so white text
 * inverts whatever is behind it and black outlines or shadows disappear. Browsers do this with
 * mix-blend-mode; MP4 export blends a separate caption layer in RGB (see lib/render-spec.ts).
 */
export function isDifferenceBlend(design: CaptionDesign): boolean {
  return design.inverted === true;
}

export const MAX_CUE_CHARS = 500;
const MIN_CUE_SECONDS = 0.2;

export function adjustCaption(cues: CaptionCue[], index: number, mode: 'move' | 'start' | 'end', delta: number, duration: number): CaptionCue[] {
  const cue = cues[index];
  if (!cue || !Number.isFinite(delta) || validateCues(cues, duration)) return cues;
  const lower = cues[index - 1]?.end ?? 0;
  const upper = cues[index + 1]?.start ?? duration;
  const minimum = Math.min(MIN_CUE_SECONDS, cue.end - cue.start);
  let { start, end } = cue;
  if (mode === 'move') {
    const shift = Math.max(lower - start, Math.min(delta, upper - end));
    start += shift; end += shift;
  } else if (mode === 'start') start = Math.max(lower, Math.min(start + delta, end - minimum));
  else end = Math.min(upper, Math.max(end + delta, start + minimum));
  return cues.map((item, i) => i === index ? { ...item, start: round(start), end: round(end) } : item);
}

export function splitCaption(cues: CaptionCue[], index: number, time: number): CaptionCue[] {
  const cue = cues[index];
  if (!cue || !Number.isFinite(time) || time - cue.start < MIN_CUE_SECONDS || cue.end - time < MIN_CUE_SECONDS) return cues;
  const words = cue.text.trim().split(/\s+/);
  const at = Math.max(1, Math.min(words.length - 1, Math.round(words.length * (time - cue.start) / (cue.end - cue.start))));
  const left = words.length > 1 ? words.slice(0, at).join(' ') : cue.text;
  const right = words.length > 1 ? words.slice(at).join(' ') : cue.text;
  return [...cues.slice(0, index), { ...cue, end: round(time), text: left }, { ...cue, start: round(time), text: right }, ...cues.slice(index + 1)];
}

/** Shift the whole track without clipping words or changing gaps between phrases. */
export function shiftCues(cues: CaptionCue[], seconds: number, duration: number): CaptionCue[] {
  if (!cues.length || !Number.isFinite(seconds) || validateCues(cues, duration)) return cues;
  const offset = Math.max(-cues[0].start, Math.min(seconds, duration - cues[cues.length - 1].end));
  return cues.map(cue => ({ ...cue, start: round(cue.start + offset), end: round(cue.end + offset) }));
}

export function activeCueIndex(cues: CaptionCue[], time: number): number {
  return cues.findIndex(cue => time >= cue.start && time < cue.end);
}

export function validateCues(cues: CaptionCue[], duration = Infinity): string | null {
  let previousEnd = 0;
  for (const cue of cues) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration + 0.05) return 'Each caption needs a valid start and end within the video.';
    if (cue.start < previousEnd) return 'Captions must be in time order and must not overlap.';
    if (!cue.text.trim()) return 'Add text to every caption, or delete empty captions.';
    previousEnd = cue.end;
  }
  return null;
}
// Model timings drift slightly; repair small problems (order, overlap, overrun, stray whitespace)
// rather than discarding a whole transcript. Cues that can't be repaired are dropped.
export function normalizeCues(cues: CaptionCue[], duration = Infinity): CaptionCue[] {
  const result: CaptionCue[] = [];
  const sorted = cues
    .filter(c => Number.isFinite(c.start) && Number.isFinite(c.end))
    .map(c => ({ ...c, start: Math.max(0, c.start), end: Math.min(c.end, duration), text: c.text.replace(/\s*\n\s*/g, '\n').replace(/[^\S\n]+/g, ' ').trim().slice(0, MAX_CUE_CHARS) }))
    .sort((a, b) => a.start - b.start);
  for (const cue of sorted) {
    const start = Math.max(cue.start, result.at(-1)?.end ?? 0);
    if (!cue.text || cue.end - start < MIN_CUE_SECONDS) continue;
    result.push({ ...cue, start: round(start), end: round(cue.end) });
  }
  return result;
}
function round(seconds: number) {
  return Math.round(seconds * 1000) / 1000;
}

// Words that lean on what follows (a line shouldn't end on them) and words that lean on what precedes
// (a line shouldn't start with them). Hinglish and English; matched case-insensitively without punctuation.
const LEADS_INTO = new Set(['ki', 'aur', 'lekin', 'magar', 'kyunki', 'agar', 'jab', 'jo', 'ya', 'na', 'ek', 'is', 'iss', 'uss', 'woh', 'yeh', 'jaise', 'taaki', 'balki',
  'mera', 'meri', 'mere', 'tera', 'teri', 'tere', 'apna', 'apni', 'apne', 'aapka', 'aapki', 'aapke', 'iska', 'iski', 'iske', 'uska', 'uski', 'uske', 'unka', 'unki', 'unke', 'jiska', 'jiski', 'jiske', 'hamara', 'hamari', 'hamare', 'and', 'but', 'or', 'so', 'the', 'a', 'an', 'of', 'to', 'that', 'with', 'for', 'in', 'on', 'my', 'your', 'our', 'their']);
const LEANS_BACK = new Set(['ko', 'se', 'ke', 'ka', 'mein', 'me', 'pe', 'par', 'tak', 'hai', 'hain', 'tha', 'thi', 'the', 'ho', 'hi', 'bhi', 'wala', 'wali', 'waale', 'waala',
  'chuka', 'chuki', 'chuke', 'raha', 'rahi', 'rahe', 'sakta', 'sakti', 'sakte', 'gaya', 'gayi', 'gaye', 'hota', 'hoti', 'hote']);
const PAUSE_SECONDS = 0.3;
const MIN_SHOW_SECONDS = 0.5;

interface TimedWord { text: string; start: number; end: number; breakAfter: boolean; cueEnd: boolean }

/**
 * Regroup captions into short phrases that change where speech naturally breaks: sentence ends,
 * commas, and pauses between cues. Within a cue, word times are estimated from word length.
 * Styled cues (with their own design) are left untouched.
 */
export function phraseCues(cues: CaptionCue[], options: { maxWords?: number; maxChars?: number } = {}): CaptionCue[] {
  const maxWords = options.maxWords ?? 5;
  const maxChars = options.maxChars ?? 32;
  const result: CaptionCue[] = [];
  let words: TimedWord[] = [];
  const flush = () => { result.push(...phraseRun(words, maxWords, maxChars)); words = []; };
  for (const [index, cue] of cues.entries()) {
    if (cue.design) { flush(); result.push(cue); continue; }
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    const weight = tokens.reduce((sum, token) => sum + token.length + 1, 0);
    let time = cue.start;
    for (const [i, token] of tokens.entries()) {
      const end = i === tokens.length - 1 ? cue.end : time + (cue.end - cue.start) * (token.length + 1) / weight;
      words.push({ text: token, start: time, end, breakAfter: /[.?!…]["')\]]*$/.test(token), cueEnd: i === tokens.length - 1 });
      time = end;
    }
    const next = cues[index + 1];
    if (words.length && (!next || next.start - cue.end > PAUSE_SECONDS)) words[words.length - 1].breakAfter = true;
  }
  flush();
  // Very short phrases flash by; let them borrow from the silence that follows, never past the next caption.
  return result.map((cue, i) => {
    const limit = result[i + 1]?.start ?? cue.end;
    const end = cue.end - cue.start < MIN_SHOW_SECONDS ? Math.min(limit, cue.start + MIN_SHOW_SECONDS) : cue.end;
    return { ...cue, start: round(cue.start), end: round(Math.max(end, cue.end)) };
  });
}

function bare(word: string) {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

// Split each pause-delimited run into chunks with a small dynamic program: prefer 3-4 words, reward
// ending at a comma or an original line end, and penalise ending on a word that leads into the next or starting with one that leans back.
function phraseRun(words: TimedWord[], maxWords: number, maxChars: number): CaptionCue[] {
  const chunks: CaptionCue[] = [];
  let runStart = 0;
  for (let i = 0; i < words.length; i++) {
    if (!words[i].breakAfter && i < words.length - 1) continue;
    const run = words.slice(runStart, i + 1);
    runStart = i + 1;
    const n = run.length;
    const best: number[] = [0, ...Array(n).fill(Infinity)];
    const from: number[] = Array(n + 1).fill(0);
    for (let end = 1; end <= n; end++) {
      for (let start = Math.max(0, end - maxWords); start < end; start++) {
        const chunk = run.slice(start, end);
        const chars = chunk.reduce((sum, w) => sum + w.text.length, 0) + chunk.length - 1;
        if (chars > maxChars && chunk.length > 1) continue;
        let cost = (chunk.length - 3.5) ** 2;
        if (chunk.length === 1 && n > 1) cost += 4;
        if (end < n && LEADS_INTO.has(bare(chunk[chunk.length - 1].text))) cost += 8;
        if (start > 0 && LEANS_BACK.has(bare(chunk[0].text))) cost += 6;
        if (end < n && /[,;:—–]$/.test(chunk[chunk.length - 1].text)) cost -= 2;
        // The transcriber's own line ends usually sit at a pause, so lean towards keeping them.
        else if (end < n && chunk[chunk.length - 1].cueEnd) cost -= 1.5;
        if (best[start] + cost < best[end]) { best[end] = best[start] + cost; from[end] = start; }
      }
    }
    const bounds: [number, number][] = [];
    for (let end = n; end > 0; end = from[end]) bounds.unshift([from[end], end]);
    for (const [start, end] of bounds) {
      const chunk = run.slice(start, end);
      chunks.push({ start: chunk[0].start, end: chunk[chunk.length - 1].end, text: chunk.map(w => w.text).join(' ') });
    }
  }
  return chunks;
}
export function clipCues(cues: CaptionCue[], start: number, end: number): CaptionCue[] {
  return cues.filter(c => c.end > start && c.start < end).map(c => ({ ...c, start: Math.max(c.start, start) - start, end: Math.min(c.end, end) - start }));
}
function timestamp(seconds: number, style: 'srt' | 'vtt' | 'ass') {
  const units = style === 'ass' ? 100 : 1000;
  const ticks = Math.round(seconds * units);
  const whole = Math.floor(ticks / units);
  const h = String(Math.floor(whole / 3600)).padStart(style === 'ass' ? 1 : 2, '0');
  const separator = style === 'srt' ? ',' : '.';
  return `${h}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}${separator}${String(ticks % units).padStart(style === 'ass' ? 2 : 3, '0')}`;
}
// A blank line ends an SRT/VTT cue early, and "-->" starts a new timing line, so neither may appear in text.
function cueText(text: string, format: 'srt' | 'vtt') {
  const lines = text.split(/\r?\n/).map(line => line.trim().replace(/-->/g, '→')).filter(Boolean).join('\n');
  return format === 'vtt' ? lines.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : lines.replace(/[<>]/g, '');
}
/** frame is the exported frame in pixels; when omitted, a 16:9 or crop-shaped 1080-based frame is assumed. */
/** blend selects which ASS captions to write: only normal ones, only difference-blend ones, or all (default). */
export function subtitles(cues: CaptionCue[], format: 'srt' | 'vtt' | 'ass', design: CaptionDesign, aspect = 'original', frame?: { width: number; height: number }, blend: 'all' | 'normal' | 'difference' = 'all'): string {
  if (format !== 'ass') {
    const text = cues.map((c, i) => `${i + 1}\n${timestamp(c.start, format)} --> ${timestamp(c.end, format)}\n${cueText(c.text, format)}\n`).join('\n');
    return format === 'vtt' ? `WEBVTT\n\n${text}` : text;
  }
  const { width, height } = assFrame(aspect, frame);
  const styles = new Map<string, string>();
  const events: string[] = [];
  for (const [index, cue] of cues.entries()) {
    if (blend !== 'all' && isDifferenceBlend(resolveCaptionDesign(cue, design)) !== (blend === 'difference')) continue;
    const name = cue.design ? `Caption${index + 1}` : 'Default';
    const rendered = assCaption(cue, resolveCaptionDesign(cue, design), width, height, name);
    for (const line of rendered.styles) styles.set(line.split(',')[0], line);
    events.push(...rendered.events);
  }
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${[...styles.values()].join('\n')}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header + events.join('\n');
}

function assCaption(c: CaptionCue, design: CaptionDesign, width: number, height: number, name: string) {
  const preset = captionPresets.find(p => p.id === design.preset) ?? captionPresets[0];
  const textColor = captionTextColor(design);
  const color = `&H00${textColor.slice(5, 7)}${textColor.slice(3, 5)}${textColor.slice(1, 3)}`;
  const fontSize = Math.round(width * design.size / 100);
  const outline = round(fontSize * .025);
  const shadow = round(fontSize * .04);
  const x = Math.max(0, Math.min(100, design.x ?? 50));
  const y = Math.max(0, Math.min(100, design.y ?? ({ top: 15, middle: 50, bottom: 85 }[design.position])));
  const position = `\\an5\\pos(${round(width * x / 100)},${round(height * y / 100)})`;
  const bg = /^#[0-9a-f]{6}$/i.test(design.backgroundColor ?? '') ? design.backgroundColor! : '#000000';
  const alpha = Math.round((1 - Math.max(0, Math.min(1, design.backgroundOpacity ?? .75))) * 255).toString(16).padStart(2, '0');
  const backgroundColor = `&H${alpha}${bg.slice(5, 7)}${bg.slice(3, 5)}${bg.slice(1, 3)}`;
  const style = (name: string, box: boolean) => `Style: ${name},${preset.font},${fontSize},${color},${color},${box ? backgroundColor : '&H33000000'},&H66000000,${preset.weight >= 600 ? -1 : 0},${preset.italic ? -1 : 0},0,0,100,100,0,0,${box ? 3 : 1},${box ? round(fontSize * (design.backgroundPadding ?? .2)) : outline},${box ? 0 : shadow},5,${Math.round(width * .07)},${Math.round(width * .07)},${Math.round(height * .1)},1`;
  const backgroundName = name === 'Default' ? 'Background' : `${name}Background`;
  const styles = [style(name, false)];
  if (design.background) styles.push(style(backgroundName, true));
  const text = c.text.replace(/[{}\\]/g, '').trim().replace(/\r?\n/g, '\\N');
  const event = (layer: number, styleName: string, overrides = '') => `Dialogue: ${layer},${timestamp(c.start, 'ass')},${timestamp(c.end, 'ass')},${styleName},,0,0,0,,{${position}${overrides}}${text}`;
  const events: string[] = [];
  if (design.background) events.push(event(0, backgroundName, '\\1a&HFF&'));
  if (design.glow) events.push(event(1, name, `\\bord${round(fontSize * .04)}\\shad0\\blur${round(fontSize * .12)}\\3c${color.replace('&H00', '&H')}&\\alpha&H50&`));
  events.push(event(design.glow || design.background ? 2 : 0, name));
  return { styles, events };
}

function assFrame(aspect: string, frame?: { width: number; height: number }) {
  if (aspect === '9:16') return { width: 608, height: 1080 };
  if (aspect === '1:1') return { width: 1080, height: 1080 };
  if (frame && frame.width > 0 && frame.height > 0) {
    // Keep the source shape; the long side becomes 1080 so styles scale the same as the crops.
    const scale = 1080 / Math.max(frame.width, frame.height);
    return { width: Math.round(frame.width * scale), height: Math.round(frame.height * scale) };
  }
  return { width: 1080, height: 608 };
}
