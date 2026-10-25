import { z } from 'zod';
import { captionPresets, clipCues, isDifferenceBlend, resolveCaptionDesign, validateCues } from './captions.ts';

const color = z.string().regex(/^#[0-9a-f]{6}$/i);
export const renderDesignSchema = z.object({
  preset: z.string().refine(value => captionPresets.some(p => p.id === value)),
  size: z.number().finite().min(3).max(10), color, position: z.enum(['top', 'middle', 'bottom']),
  glow: z.boolean().optional(), inverted: z.boolean().optional(),
  x: z.number().finite().min(0).max(100).optional(), y: z.number().finite().min(0).max(100).optional(),
  background: z.boolean().optional(), backgroundColor: color.optional(),
  backgroundOpacity: z.number().min(0).max(1).optional(), backgroundPadding: z.number().min(0).max(.6).optional(),
  backgroundRadius: z.number().min(0).max(.5).optional(),
});
export const renderSpecSchema = z.object({
  fileName: z.string().min(1).max(250), mimeType: z.enum(['video/mp4', 'video/quicktime', 'video/webm']),
  start: z.number().finite().min(0), end: z.number().finite().positive(),
  crop: z.enum(['original', '9:16', '1:1']), fitBackground: z.boolean(),
  pan: z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) }),
  cues: z.array(z.object({ start: z.number().finite().min(0), end: z.number().finite().positive(), text: z.string().min(1).max(500), design: renderDesignSchema.optional() })).max(2000),
  design: renderDesignSchema,
  // compatible: H.264 High + AAC that plays in browsers, phones and social uploads; lossless: archival master.
  quality: z.enum(['compatible', 'lossless']).default('compatible'),
}).refine(s => s.end > s.start && s.end - s.start <= 3 * 3600, 'Choose a range of up to three hours.')
  .refine(s => !validateCues(s.cues), 'Captions must have valid, non-overlapping timings.');
export type RenderSpec = z.infer<typeof renderSpecSchema>;
export interface MediaStream {
  codec_type: string; codec_name?: string; width?: number; height?: number; pix_fmt?: string;
  sample_aspect_ratio?: string; color_range?: string; color_space?: string; color_transfer?: string; color_primaries?: string;
  sample_rate?: string; channels?: number; bits_per_raw_sample?: string; sample_fmt?: string;
  side_data_list?: { rotation?: number }[];
}
export interface MediaInfo { streams: MediaStream[]; format: { duration: string } }

export function renderPlan(spec: RenderSpec, media: MediaInfo) {
  const video = media.streams.find(s => s.codec_type === 'video');
  const audio = media.streams.filter(s => s.codec_type === 'audio');
  const duration = Number(media.format.duration);
  if (!video?.width || !video.height || !Number.isFinite(duration) || spec.end > duration + .1) throw new Error('The video or selected time range is invalid.');
  if (video.color_transfer === 'smpte2084' || video.color_transfer === 'arib-std-b67') throw new Error('HDR export is not supported yet. Export was stopped to avoid changing its brightness or colors.');
  if (video.sample_aspect_ratio && !['1:1', '0:1', 'N/A'].includes(video.sample_aspect_ratio)) throw new Error('Non-square-pixel video is not supported yet; no quality conversion was applied.');
  const pixelFormat = video.pix_fmt ?? '';
  if (!['yuv420p', 'yuv422p', 'yuv444p', 'yuvj420p', 'yuvj422p', 'yuvj444p', 'yuv420p10le', 'yuv422p10le', 'yuv444p10le', 'gray', 'gray10le', 'rgb24', 'bgr24', 'gbrp'].includes(pixelFormat)) throw new Error(`Source pixel format ${pixelFormat} cannot be preserved by this renderer.`);
  const rotation = Math.abs(video.side_data_list?.find(s => s.rotation !== undefined)?.rotation ?? 0) % 180;
  let width = rotation === 90 ? video.height : video.width;
  let height = rotation === 90 ? video.width : video.height;
  const filters: string[] = [];
  if (spec.crop !== 'original') {
    const ratio = spec.crop === '1:1' ? 1 : 9 / 16;
    if (spec.fitBackground) {
      // Expand the canvas instead of reducing the resolution of the original picture.
      const outWidth = Math.ceil(Math.max(width, height * ratio) / 2) * 2;
      const outHeight = Math.ceil(Math.max(height, width / ratio) / 2) * 2;
      filters.push(`pad=${outWidth}:${outHeight}:(ow-iw)/2:(oh-ih)/2:black`);
      width = outWidth; height = outHeight;
    } else {
      const outWidth = Math.max(2, Math.floor(Math.min(width, height * ratio) / 2) * 2);
      const outHeight = Math.max(2, Math.floor(Math.min(height, width / ratio) / 2) * 2);
      const x = Math.floor((width - outWidth) * spec.pan.x / 100 / 2) * 2;
      const y = Math.floor((height - outHeight) * spec.pan.y / 100 / 2) * 2;
      filters.push(`crop=${outWidth}:${outHeight}:${x}:${y}`);
      width = outWidth; height = outHeight;
    }
  }
  const cues = clipCues(spec.cues, spec.start, Math.min(spec.end, duration));
  const difference = cues.some(c => isDifferenceBlend(resolveCaptionDesign(c, spec.design)));
  const normal = cues.some(c => !isDifferenceBlend(resolveCaptionDesign(c, spec.design)));
  const whole = spec.start === 0 && spec.end >= duration - .05;
  const lossless = spec.quality === 'lossless';
  const rgb = ['rgb24', 'bgr24', 'gbrp'].includes(pixelFormat);
  if (difference && lossless && /10le$/.test(pixelFormat)) throw new Error('Difference-blend captions need an 8-bit source for lossless export. Use Compatible quality or turn off the inverted effect.');
  let graph: string | null = null;
  if (!difference) {
    if (normal) filters.push('subtitles=captions.ass:fontsdir=fonts');
  } else {
    // libass can't blend, so difference captions are drawn on a black copy of each frame and combined
    // in RGB: |video - caption|. Black (outlines, shadows, empty areas) leaves the video unchanged.
    const matrix = video.color_space === 'bt709' ? 'bt709' : ['smpte170m', 'bt470bg'].includes(video.color_space ?? '') ? 'bt601' : height >= 720 ? 'bt709' : 'bt601';
    const range = video.color_range === 'pc' || pixelFormat.startsWith('yuvj') ? 'pc' : 'tv';
    // zscale with point chroma resampling converts YUV -> float RGB -> YUV exactly (swscale shifts BT.709
    // colours by several steps, and bicubic chroma resampling isn't reversible at sharp edges).
    const zMatrix = matrix === 'bt709' ? '709' : '170m';
    const zRange = range === 'pc' ? 'full' : 'limited';
    const toRgb = rgb ? 'format=gbrpf32le' : `zscale=matrixin=${zMatrix}:rangein=${zRange}:filter=point,format=gbrpf32le`;
    // zscale tags its output with the matrix and range it used; restore the source's own tags (often
    // "unknown") so players decode the export exactly as they decode the source.
    const tagRange = ['tv', 'pc'].includes(video.color_range ?? '') ? video.color_range : 'unknown';
    const tagSpace = ['bt709', 'smpte170m', 'bt470bg', 'bt2020nc', 'fcc', 'smpte240m'].includes(video.color_space ?? '') ? video.color_space : 'unknown';
    const fromRgb = lossless ? 'format=rgb24' : `zscale=matrix=${zMatrix}:range=${zRange}:filter=point,format=yuv420p,setparams=range=${tagRange}:colorspace=${tagSpace}`;
    // Plain difference mode would also flip slightly negative (out-of-gamut) float values where the caption
    // layer is empty, so only pixels the caption covers are blended. The expression is ~3x slower than
    // the built-in mode, so it's switched on only while a difference caption is on screen (source time,
    // because output-side seeking runs filters on source timestamps).
    const windows = cues.filter(c => isDifferenceBlend(resolveCaptionDesign(c, spec.design))).map(c => `between(t\,${round3(c.start + spec.start)}\,${round3(c.end + spec.start)})`);
    const enable = windows.length <= 200 ? `:enable='${windows.join('+')}'` : '';
    graph = `[0:v]${filters.length ? filters.join(',') + ',' : ''}split[base][layer];`
      + `[layer]drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,subtitles=difference.ass:fontsdir=fonts,${toRgb}[top];`
      + `[base]${normal ? 'subtitles=captions.ass:fontsdir=fonts,' : ''}${toRgb}[bottom];`
      + `[bottom][top]blend=all_expr='if(gt(B\,0)\,abs(A-B)\,A)'${enable},${fromRgb}[v]`;
  }
  const audioArgs: string[] = [];
  let copied = 0;
  audio.forEach((stream, i) => {
    // Only codecs every target player decodes are copied in compatible mode.
    const copyable = lossless ? ['aac', 'mp3', 'alac', 'ac3', 'eac3'] : ['aac', 'mp3'];
    if (whole && copyable.includes(stream.codec_name ?? '')) {
      audioArgs.push(`-c:a:${i}`, 'copy'); copied++;
    } else if (lossless) {
      if (Number(stream.bits_per_raw_sample) > 24 || stream.codec_name?.startsWith('pcm_f')) throw new Error('This audio needs more than 24-bit lossless precision. Export was stopped instead of reducing audio quality.');
      audioArgs.push(`-c:a:${i}`, 'alac', `-sample_fmt:a:${i}`, 's32p');
    } else {
      // AAC keeps the source sample rate and channel count; 320 kb/s stereo (scaled per channel) is transparent for speech and music.
      const channels = Math.max(1, stream.channels ?? 2);
      audioArgs.push(`-c:a:${i}`, 'aac', `-b:a:${i}`, `${Math.min(512, 160 * channels)}k`);
    }
  });
  const args = ['-hide_banner', '-v', 'warning', '-nostdin', '-y', '-protocol_whitelist', 'file,pipe', '-f', spec.mimeType === 'video/webm' ? 'matroska' : 'mov', '-i', 'source'];
  if (!whole) args.push('-ss', String(spec.start), '-t', String(Math.min(spec.end, duration) - spec.start));
  if (graph) args.push('-filter_complex', graph, '-map', '[v]');
  else args.push('-map', '0:v:0');
  args.push('-map', '0:a?', '-map_metadata', '0');
  if (!graph && filters.length) args.push('-vf', filters.join(','));
  // Lossless difference exports stay in RGB after blending, so no YUV round trip is added.
  const rgbOut = rgb || (lossless && difference);
  if (lossless) args.push('-c:v', rgbOut ? 'libx264rgb' : 'libx264', '-preset', 'medium', '-crf', '0', '-pix_fmt', rgbOut ? 'rgb24' : pixelFormat);
  // CRF 17 is visually transparent; 8-bit 4:2:0 High profile is what browsers, phones and social uploads decode.
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-tag:v', 'avc1');
  args.push('-fps_mode', 'passthrough', '-threads', '2');
  for (const [key, value] of [['color_range', video.color_range], ['colorspace', video.color_space], ['color_trc', video.color_transfer], ['color_primaries', video.color_primaries]]) {
    if (rgbOut && lossless && (key === 'colorspace' || key === 'color_range')) continue; // RGB output has no YUV matrix or range
    if (value && value !== 'unknown' && value !== 'unspecified') args.push(`-${key}`, value);
  }
  args.push(...audioArgs, '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', 'output.mp4');
  const audioSummary = audio.length === 0 ? 'No audio track' : copied === audio.length ? 'Original audio copied without re-encoding'
    : lossless ? 'Audio preserved with lossless ALAC; original sample rate and channel count' : 'Audio encoded as high-bitrate AAC; original sample rate and channel count';
  return { args, width, height, duration: Math.min(spec.end, duration) - spec.start, cues, audio: audioSummary, pixelFormat: lossless ? (rgbOut ? 'rgb24' : pixelFormat) : 'yuv420p', whole, lossless, difference, normal };
}

function round3(seconds: number) {
  return Math.round(seconds * 1000) / 1000;
}
