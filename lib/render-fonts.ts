import { create, type Font } from 'fontkit';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captionPresets, resolveCaptionDesign, type CaptionCue, type CaptionDesign } from './captions.ts';

export interface ExportFont { preset: string; data: string }
const bundled = join(process.cwd(), 'public', 'fonts', 'captions');
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
function parse(data: Buffer): Font[] {
  const font = create(data);
  return 'fonts' in font ? font.fonts : [font];
}
let inventory: Promise<{ path: string; family: string }[]> | undefined;
async function installedFonts() {
  inventory ??= (async () => {
    const paths = process.platform === 'win32' ? [join(process.env.WINDIR ?? 'C:/Windows', 'Fonts')] : ['/usr/share/fonts', '/usr/local/share/fonts', '/System/Library/Fonts', '/Library/Fonts'];
    const entries: { path: string; family: string }[] = [];
    for (const root of paths) {
      const names = await readdir(root, { recursive: true }).catch(() => [] as string[]);
      for (const name of names.slice(0, 4000)) {
        if (!/\.(ttf|otf|ttc)$/i.test(name)) continue;
        const path = join(root, name);
        try { for (const font of parse(await readFile(path))) entries.push({ path, family: font.familyName }); } catch { /* Ignore non-font or unsupported files. */ }
      }
    }
    return entries;
  })();
  return inventory;
}

/** Copies actual fonts into an isolated job directory; never silently substitutes a typeface. */
export async function prepareRenderFonts(dir: string, cues: CaptionCue[], design: CaptionDesign, uploads: ExportFont[]) {
  const fontDir = join(dir, 'fonts');
  await mkdir(fontDir, { recursive: true });
  const names = new Map<string, string>();
  const required = new Map<string, string>();
  for (const cue of cues) {
    const chosen = resolveCaptionDesign(cue, design);
    required.set(chosen.preset, `${required.get(chosen.preset) ?? ''}${cue.text}`);
  }
  const bundledFiles = await readdir(bundled);
  for (const [id, text] of required) {
    const preset = captionPresets.find(p => p.id === id)!;
    const upload = uploads.find(f => f.preset === id);
    let data: Buffer | undefined;
    let font: Font | undefined;
    if (upload) {
      data = Buffer.from(upload.data, 'base64');
      if (data.length > 10 * 1024 * 1024 || !['00010000', '4f54544f', '74746366'].includes(data.subarray(0, 4).toString('hex'))) throw new Error(`Upload a TTF or OTF file for ${preset.font} to render MP4. WOFF files are preview-only.`);
      font = parse(data)[0];
    } else {
      for (const file of bundledFiles.filter(f => /\.(ttf|otf)$/i.test(f))) {
        const candidate = await readFile(join(bundled, file));
        const match = parse(candidate).find(f => normalized(f.familyName) === normalized(preset.font));
        if (match) { data = candidate; font = match; break; }
      }
      if (!font) {
        const match = (await installedFonts()).find(f => normalized(f.family) === normalized(preset.font));
        if (match) { data = await readFile(match.path); font = parse(data).find(f => normalized(f.familyName) === normalized(preset.font)); }
      }
    }
    if (!font || !data) throw new Error(`${preset.font} is missing on the renderer. Load its TTF or OTF file in the caption font panel before exporting.`);
    if (!font.familyName || /[,\r\n{}\\]/.test(font.familyName)) throw new Error('The uploaded font has an invalid family name.');
    for (const character of text) {
      if (!/\s/.test(character) && !font.hasGlyphForCodePoint(character.codePointAt(0)!)) throw new Error(`${preset.font} cannot render “${character}”. Choose a font containing this character before exporting.`);
    }
    await writeFile(join(fontDir, `${id}.ttf`), data);
    names.set(preset.font, font.familyName);
  }
  return names;
}
