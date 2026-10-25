import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPlan, renderSpecSchema, type MediaInfo, type RenderSpec } from '../lib/render-spec.ts';
import { defaultCaptionDesign } from '../lib/captions.ts';

const spec: RenderSpec = { fileName: 'clip.mp4', mimeType: 'video/mp4', start: 0, end: 10, crop: 'original', fitBackground: false, pan: { x: 50, y: 50 }, cues: [], design: defaultCaptionDesign, quality: 'lossless' };
const media: MediaInfo = { format: { duration: '10' }, streams: [{ codec_type: 'video', width: 1920, height: 1080, pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1' }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 }] };
test('full exports preserve dimensions, source pixel format, timing, and audio packets', () => {
  const plan = renderPlan(spec, media);
  assert.equal(plan.width, 1920); assert.equal(plan.height, 1080);
  assert.equal(plan.args[plan.args.indexOf('-crf') + 1], '0');
  assert.equal(plan.args[plan.args.indexOf('-pix_fmt') + 1], 'yuv420p');
  assert.equal(plan.args[plan.args.indexOf('-c:a:0') + 1], 'copy');
  assert.ok(!plan.args.includes('-r')); assert.ok(!plan.args.includes('-ar')); assert.ok(!plan.args.includes('-ac'));
  assert.ok(!plan.args.includes('-vf'));
});
test('accurate audio trims use lossless encoding, preserve all audio tracks, and clip caption times', () => {
  const plan = renderPlan({ ...spec, start: 2, end: 6, cues: [{ start: 1, end: 3, text: 'Boundary' }, { start: 4, end: 5, text: 'Inside' }] }, { ...media, streams: [...media.streams, media.streams[1]] });
  assert.equal(plan.args[plan.args.indexOf('-c:a:0') + 1], 'alac');
  assert.equal(plan.args[plan.args.indexOf('-c:a:1') + 1], 'alac');
  assert.deepEqual(plan.cues.map(c => [c.start, c.end]), [[0, 1], [2, 3]]);
  assert.ok(plan.args.indexOf('-ss') > plan.args.indexOf('-i'));
});
test('crop removes only the requested edges; fit adds a canvas without shrinking the picture', () => {
  const cropped = renderPlan({ ...spec, crop: '9:16', pan: { x: 100, y: 50 } }, media);
  assert.equal(cropped.width, 606); assert.equal(cropped.height, 1080);
  assert.ok(cropped.args.includes('crop=606:1080:1314:0'));
  const fit = renderPlan({ ...spec, crop: '1:1', fitBackground: true }, media);
  assert.equal(fit.width, 1920); assert.equal(fit.height, 1920);
  assert.ok(fit.args.includes('pad=1920:1920:(ow-iw)/2:(oh-ih)/2:black'));
});
test('unsupported precision and HDR fail instead of silently reducing quality', () => {
  assert.throws(() => renderPlan(spec, { ...media, streams: [{ ...media.streams[0], color_transfer: 'smpte2084' }] }), /HDR/);
  assert.throws(() => renderPlan(spec, { ...media, streams: [{ ...media.streams[0], pix_fmt: 'yuv444p16le' }] }), /cannot be preserved/);
  assert.throws(() => renderPlan({ ...spec, start: 1 }, { ...media, streams: [media.streams[0], { codec_type: 'audio', codec_name: 'pcm_f32le' }] }), /precision/);
  assert.throws(() => renderPlan({ ...spec, end: 20 }, media), /time range/);
});
test('export inputs reject unsafe colors, nonfinite numbers, overlaps and arbitrary presets', () => {
  assert.equal(renderSpecSchema.safeParse(spec).success, true);
  for (const patch of [{ start: NaN }, { end: -1 }, { pan: { x: 101, y: 0 } }, { design: { ...defaultCaptionDesign, color: 'red;movie=file' } }, { design: { ...defaultCaptionDesign, preset: '../font' } }, { cues: [{ start: 0, end: 2, text: 'a' }, { start: 1, end: 3, text: 'b' }] }]) assert.equal(renderSpecSchema.safeParse({ ...spec, ...patch }).success, false);
});
test('compatible exports use browser-playable H.264 High and AAC without changing size, rate or channels', () => {
  const compatible: RenderSpec = { ...spec, quality: 'compatible' };
  const whole = renderPlan(compatible, media);
  assert.equal(whole.args[whole.args.indexOf('-c:v') + 1], 'libx264');
  assert.equal(whole.args[whole.args.indexOf('-crf') + 1], '17');
  assert.equal(whole.args[whole.args.indexOf('-profile:v') + 1], 'high');
  assert.equal(whole.args[whole.args.indexOf('-pix_fmt') + 1], 'yuv420p');
  assert.equal(whole.args[whole.args.indexOf('-c:a:0') + 1], 'copy');
  assert.equal(whole.width, 1920); assert.equal(whole.height, 1080);
  assert.ok(!whole.args.includes('-ar') && !whole.args.includes('-ac') && !whole.args.includes('-r'));
  const trimmed = renderPlan({ ...compatible, start: 2, end: 6 }, { ...media, streams: [media.streams[0], { codec_type: 'audio', codec_name: 'pcm_f32le', channels: 6 }] });
  assert.equal(trimmed.args[trimmed.args.indexOf('-c:a:0') + 1], 'aac');
  assert.equal(trimmed.args[trimmed.args.indexOf('-b:a:0') + 1], '512k');
  assert.ok(!trimmed.args.includes('alac'));
  // AC-3 can't play in browsers, so even a full-length export re-encodes it.
  const ac3 = renderPlan(compatible, { ...media, streams: [media.streams[0], { codec_type: 'audio', codec_name: 'ac3', channels: 2 }] });
  assert.equal(ac3.args[ac3.args.indexOf('-c:a:0') + 1], 'aac');
});
test('export specs default to compatible quality', () => {
  const { quality: _quality, ...withoutQuality } = spec;
  const parsed = renderSpecSchema.parse(withoutQuality);
  assert.equal(parsed.quality, 'compatible');
  assert.equal(renderSpecSchema.safeParse({ ...spec, quality: 'ultra' }).success, false);
});
test('difference-blend captions render on their own layer and blend in RGB', () => {
  const inverted = { ...defaultCaptionDesign, inverted: true };
  const both = renderPlan({ ...spec, quality: 'compatible', cues: [{ start: 1, end: 2, text: 'plain' }, { start: 3, end: 4, text: 'inv', design: inverted }] }, media);
  const graph = both.args[both.args.indexOf('-filter_complex') + 1];
  assert.ok(both.difference && both.normal);
  assert.match(graph, /drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,subtitles=difference\.ass/);
  assert.match(graph, /\[base\]subtitles=captions\.ass/);
  // Only caption pixels are blended, and only while a difference caption is on screen.
  assert.ok(graph.includes("blend=all_expr='if(gt(B\,0)\,abs(A-B)\,A)':enable='between(t\,3\,4)'"), graph);
  assert.match(graph, /format=gbrpf32le\[top\]/);
  // Untagged sources stay untagged, so the RGB round trip can't change how players decode colours.
  assert.match(graph, /zscale=matrix=709:range=limited:filter=point,format=yuv420p,setparams=range=unknown:colorspace=unknown\[v\]$/);
  const tagged = renderPlan({ ...spec, quality: 'compatible', design: inverted, cues: [{ start: 1, end: 2, text: 'x' }] }, { ...media, streams: [{ ...media.streams[0], color_space: 'bt709', color_range: 'tv' }, media.streams[1]] });
  assert.match(tagged.args[tagged.args.indexOf('-filter_complex') + 1], /setparams=range=tv:colorspace=bt709\[v\]$/);
  assert.ok(!both.args.includes('-vf') && both.args.includes('[v]'));
  // Crop runs before the split so both layers share the cropped frame.
  const cropped = renderPlan({ ...spec, quality: 'compatible', crop: '9:16', design: inverted, cues: [{ start: 1, end: 2, text: 'x' }] }, media);
  const croppedGraph = cropped.args[cropped.args.indexOf('-filter_complex') + 1];
  assert.match(croppedGraph, /^\[0:v\]crop=606:1080:\d+:0,split\[base\]\[layer\];/);
  assert.doesNotMatch(croppedGraph, /captions\.ass/);
  // Lossless stays in RGB after blending instead of converting back to YUV.
  const master = renderPlan({ ...spec, design: inverted, cues: [{ start: 1, end: 2, text: 'x' }] }, media);
  assert.equal(master.args[master.args.indexOf('-c:v') + 1], 'libx264rgb');
  assert.equal(master.args[master.args.indexOf('-pix_fmt') + 1], 'rgb24');
  assert.throws(() => renderPlan({ ...spec, design: inverted, cues: [{ start: 1, end: 2, text: 'x' }] }, { ...media, streams: [{ ...media.streams[0], pix_fmt: 'yuv420p10le' }, media.streams[1]] }), /8-bit/);
  // Without difference captions the simple -vf path is unchanged.
  const plain = renderPlan({ ...spec, cues: [{ start: 1, end: 2, text: 'x' }] }, media);
  assert.ok(plain.args.includes('-vf') && !plain.args.includes('-filter_complex'));
});
