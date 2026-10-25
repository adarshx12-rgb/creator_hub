import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCaptionDesign, styleCaption, adjustCaption, splitCaption, captionTextColor, isDifferenceBlend, activeCueIndex, captionPresets, shiftCues, clipCues, defaultCaptionDesign, normalizeCues, phraseCues, subtitles, validateCues } from '../lib/captions.ts';

test('styling a selected caption leaves its neighbours and track defaults unchanged', () => {
  const cues = [{ start: 0, end: 2, text: 'First' }, { start: 3, end: 5, text: 'Second' }];
  const design = { ...defaultCaptionDesign, preset: 'poppins', color: '#ff0000', glow: true, background: true, x: 25, y: 30 };
  const updated = styleCaption(cues, 1, design);
  assert.equal(updated[0], cues[0]);
  assert.deepEqual(resolveCaptionDesign(updated[0], defaultCaptionDesign), defaultCaptionDesign);
  assert.deepEqual(resolveCaptionDesign(updated[1], defaultCaptionDesign), design);
  assert.notEqual(updated[1].design, design);
  assert.equal(resolveCaptionDesign(cues[1], defaultCaptionDesign), defaultCaptionDesign);
  assert.deepEqual(styleCaption(cues, -1, design), cues);
  const split = splitCaption(updated, 1, 4);
  assert.deepEqual(split[1].design, design);
  assert.deepEqual(split[2].design, design);
  const changedHalf = styleCaption(split, 2, { ...design, color: '#00ff00' });
  assert.equal(changedHalf[1].design?.color, '#ff0000');
  assert.equal(changedHalf[2].design?.color, '#00ff00');
  assert.deepEqual(clipCues(updated, 3.5, 4.5)[0].design, design);
  assert.deepEqual(normalizeCues(updated, 6)[1].design, design);
});

test('ASS exports each caption with its own appearance and position', () => {
  const cues = styleCaption([{ start: 0, end: 2, text: 'First' }, { start: 3, end: 5, text: 'Second' }], 1, { ...defaultCaptionDesign, preset: 'poppins', color: '#ff0000', background: true, x: 25, y: 30 });
  const output = subtitles(cues, 'ass', defaultCaptionDesign);
  assert.ok(output.includes('Style: Default,Montserrat,'));
  assert.ok(output.includes('Style: Caption2,Poppins,'));
  assert.ok(output.includes('Style: Caption2Background,Poppins,'));
  const first = output.split('\n').filter(line => line.startsWith('Dialogue:') && line.endsWith('First'));
  const second = output.split('\n').filter(line => line.startsWith('Dialogue:') && line.endsWith('Second'));
  assert.equal(first.length, 1);
  assert.ok(first[0].includes(',Default,'));
  assert.ok(first[0].includes('\\pos(540,516.8)'));
  assert.equal(second.length, 2);
  assert.ok(second.every(line => line.includes('\\pos(270,182.4)')));
  assert.ok(second[1].includes(',Caption2,'));
});

test('inverted captions keep their color and blend with difference instead of flipping the color', () => {
  const design = { ...defaultCaptionDesign, color: '#123456', inverted: true };
  assert.equal(captionTextColor(design), '#123456');
  assert.equal(isDifferenceBlend(design), true);
  assert.equal(isDifferenceBlend({ ...design, inverted: false }), false);
  assert.equal(captionTextColor({ ...defaultCaptionDesign, inverted: true }), '#ffffff');
});
test('ASS output can be split into normal and difference-blend layers', () => {
  const cues = [{ start: 0, end: 1, text: 'plain' }, { start: 1, end: 2, text: 'inverted', design: { ...defaultCaptionDesign, inverted: true } }];
  const normal = subtitles(cues, 'ass', defaultCaptionDesign, 'original', undefined, 'normal');
  const difference = subtitles(cues, 'ass', defaultCaptionDesign, 'original', undefined, 'difference');
  assert.ok(normal.includes('}plain') && !normal.includes('}inverted'));
  assert.ok(difference.includes('}inverted') && !difference.includes('}plain'));
  assert.ok(subtitles(cues, 'ass', defaultCaptionDesign).includes('}plain'));
});

test('glow exports a blurred layer below crisp inverted text, with unchanged plain subtitles', () => {
  const cues = [{ start: 1, end: 2, text: 'Hello {\\pos(0,0)}' }];
  const design = { ...defaultCaptionDesign, color: '#ff0000', inverted: true, glow: true };
  const output = subtitles(cues, 'ass', design);
  assert.match(output, /&H000000ff/); // inverted no longer flips the color; it blends at render time
  const lines = output.split('\n').filter(line => line.startsWith('Dialogue:'));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Dialogue: 1,0:00:01.00,0:00:02.00,/);
  assert.ok(lines[0].includes('\\blur'));
  assert.ok(lines[0].includes('\\3c&H0000ff&'));
  assert.match(lines[1], /^Dialogue: 2,0:00:01.00,0:00:02.00,/);
  assert.ok(!lines[1].includes('\\blur'));
  assert.ok(!output.includes('\\pos(0,0)'));
  for (const format of ['srt', 'vtt'] as const) {
    assert.equal(subtitles(cues, format, design), subtitles(cues, format, defaultCaptionDesign));
  }
  assert.equal(subtitles(cues, 'ass', { ...design, glow: false }).split('\n').filter(line => line.startsWith('Dialogue:')).length, 1);
});

test('playback switches captions at phrase boundaries and clears during silence or seeks', () => {
  const cues = [{ start: 1, end: 2, text: 'First' }, { start: 2, end: 3, text: 'Second' }, { start: 4, end: 5, text: 'Third' }];
  assert.deepEqual([0, 1, 1.999, 2, 3, 4, 5, 1.5].map(time => activeCueIndex(cues, time)), [-1, 0, 0, 1, -1, 2, -1, 0]);
});

test('timing adjustments preserve phrases and gaps at video boundaries', () => {
  const cues = [{ start: 0.05, end: 1, text: 'First' }, { start: 2, end: 3.95, text: 'Second' }];
  const earlier = shiftCues(cues, -0.1, 4);
  const later = shiftCues(cues, 0.1, 4);
  assert.deepEqual(earlier, [{ start: 0, end: 0.95, text: 'First' }, { start: 1.95, end: 3.9, text: 'Second' }]);
  assert.deepEqual(later, [{ start: 0.1, end: 1.05, text: 'First' }, { start: 2.05, end: 4, text: 'Second' }]);
  assert.equal(validateCues(earlier, 4), null);
  assert.equal(validateCues(later, 4), null);
  assert.deepEqual(shiftCues([], 1, 4), []);
  assert.deepEqual(shiftCues(cues, NaN, 4), cues);
});

test('every caption style exports its font and preserves dialogue timing', () => {
  for (const preset of captionPresets) {
    const output = subtitles([{ start: 1.25, end: 2.75, text: 'Dialogue' }], 'ass', { ...defaultCaptionDesign, preset: preset.id });
    assert.ok(output.includes(`Style: Default,${preset.font},`));
    assert.ok(output.includes('Dialogue: 0,0:00:01.25,0:00:02.75,'));
  }
});

test('trim clips boundary cues, preserves gaps, and rebases to the exported clip', () => {
  assert.deepEqual(clipCues([{ start: 1, end: 4, text: 'Aaj we begin' }, { start: 6, end: 9, text: 'Next' }, { start: 10, end: 11, text: 'Outside' }], 3, 8), [{ start: 0, end: 1, text: 'Aaj we begin' }, { start: 3, end: 5, text: 'Next' }]);
});
test('rejects overlapping, reversed, nonfinite, empty, and out-of-video captions', () => {
  for (const cue of [{ start: -1, end: 2, text: 'x' }, { start: 2, end: 1, text: 'x' }, { start: NaN, end: 2, text: 'x' }, { start: 0, end: 1, text: '' }, { start: 0, end: 11, text: 'x' }]) assert.ok(validateCues([cue], 10));
  assert.ok(validateCues([{ start: 0, end: 2, text: 'x' }, { start: 1, end: 3, text: 'y' }]));
  assert.equal(validateCues([{ start: 0, end: 2, text: 'x' }, { start: 2, end: 3, text: 'y' }]), null);
});
test('SRT and VTT export proper timestamp rollover and readable Hinglish', () => {
  const cues = [{ start: 59.9996, end: 62.2, text: 'Aaj hum start karenge' }];
  assert.match(subtitles(cues, 'srt', defaultCaptionDesign), /00:01:00,000 --> 00:01:02,200\nAaj hum start karenge/);
  assert.match(subtitles(cues, 'vtt', defaultCaptionDesign), /^WEBVTT\n\n1\n00:01:00.000 --> 00:01:02.200/);
});
test('ASS carries portrait layout and styles without allowing subtitle override injection', () => {
  const output = subtitles([{ start: 0, end: 2, text: 'Hello {\\pos(0,0)}\nworld' }], 'ass', { ...defaultCaptionDesign, position: 'top', color: '#ff0000' }, '9:16');
  assert.match(output, /PlayResX: 608\nPlayResY: 1080/);
  assert.match(output, /&H000000ff/);
  assert.ok(!output.includes('{\\pos'));
  assert.match(output, /Hello pos\(0,0\)\\Nworld/);
});
test('normalize repairs model timing drift instead of discarding the transcript', () => {
  const cues = normalizeCues([
    { start: 4, end: 6, text: '  second\n\n  line ' },
    { start: 0, end: 2.5, text: 'first' },
    { start: 2.4, end: 4.2, text: 'overlaps both' },
    { start: 6, end: 6.1, text: 'too short' },
    { start: 7, end: 9, text: '   ' },
    { start: 9.5, end: 12, text: 'runs past the end' },
    { start: 11, end: 13, text: 'starts after the end' },
  ], 10);
  assert.deepEqual(cues, [
    { start: 0, end: 2.5, text: 'first' },
    { start: 2.5, end: 4.2, text: 'overlaps both' },
    { start: 4.2, end: 6, text: 'second\nline' },
    { start: 9.5, end: 10, text: 'runs past the end' },
  ]);
  assert.equal(validateCues(cues, 10), null);
});
test('SRT and VTT cue text cannot break out of its cue', () => {
  const cues = [{ start: 0, end: 1, text: 'A & B\n\n--> 00:00:09,000 12:30:45,123' }];
  const vtt = subtitles(cues, 'vtt', defaultCaptionDesign);
  assert.match(vtt, /A &amp; B\n→ 00:00:09,000 12:30:45,123\n/);
  assert.equal(vtt.match(/-->/g)?.length, 1);
  assert.match(subtitles(cues, 'srt', defaultCaptionDesign), /00:00:00,000 --> 00:00:01,000\nA & B\n→/);
});
test('ASS keeps a portrait original frame and exports the selected font', () => {
  const output = subtitles([{ start: 0, end: 1, text: 'hi' }], 'ass', { ...defaultCaptionDesign, preset: 'poppins' }, 'original', { width: 720, height: 1280 });
  assert.match(output, /PlayResX: 608\nPlayResY: 1080/);
  assert.match(output, /Style: Default,Poppins,/);
});


test('caption clips clamp movement and trims to neighbours without modifying other captions', () => {
  const cues = [{ start: 1, end: 2, text: 'One' }, { start: 3, end: 5, text: 'Two' }, { start: 6, end: 7, text: 'Three' }];
  assert.deepEqual(adjustCaption(cues, 1, 'move', 100, 10)[1], { start: 4, end: 6, text: 'Two' });
  assert.deepEqual(adjustCaption(cues, 1, 'move', -100, 10)[1], { start: 2, end: 4, text: 'Two' });
  assert.equal(adjustCaption(cues, 1, 'start', 100, 10)[1].start, 4.8);
  assert.equal(adjustCaption(cues, 1, 'end', -100, 10)[1].end, 3.2);
  for (const mode of ['move', 'start', 'end'] as const) {
    for (const delta of [-100, -.15, .15, 100]) {
      const next = adjustCaption(cues, 1, mode, delta, 10);
      assert.equal(validateCues(next, 10), null);
      assert.deepEqual(next[0], cues[0]); assert.deepEqual(next[2], cues[2]);
    }
  }
});

test('splitting preserves text and clip boundaries and refuses tiny fragments', () => {
  const cues = [{ start: 1, end: 5, text: 'One two three four' }];
  assert.deepEqual(splitCaption(cues, 0, 3), [{ start: 1, end: 3, text: 'One two' }, { start: 3, end: 5, text: 'three four' }]);
  assert.equal(splitCaption(cues, 0, 1.1), cues);
  assert.equal(splitCaption(cues, 0, 5), cues);
  assert.equal(splitCaption(cues, 0, NaN), cues);
});

test('background and custom position export as separate layers with unchanged cue timing', () => {
  const output = subtitles([{ start: 1, end: 2, text: 'Hello' }], 'ass', { ...defaultCaptionDesign, background: true, backgroundColor: '#123456', backgroundOpacity: .5, x: 25, y: 40 });
  assert.ok(output.includes('Style: Background,'));
  assert.ok(output.includes('&H80563412'));
  assert.ok(output.includes('\\pos(270,243.2)'));
  assert.match(output, /Dialogue: 0,0:00:01.00,0:00:02.00,Background/);
  assert.match(output, /Dialogue: 2,0:00:01.00,0:00:02.00,Default/);
});
test('phrases break at sentence ends and pauses, stay short, and never end on a connecting word', () => {
  const cues = phraseCues([
    { start: 0, end: 3, text: 'Yeh website aisi thi ki iske content ko use karke' },
    { start: 3, end: 5, text: 'masti chalta tha lekin woh masti' },
    { start: 5, end: 6.5, text: 'kis level tak gaya.' },
    { start: 8, end: 9, text: 'Na koi warning,' },
    { start: 9, end: 10, text: 'na koi context.' },
  ]);
  assert.equal(validateCues(cues), null);
  for (const cue of cues) {
    assert.ok(cue.text.split(' ').length <= 5, cue.text);
    assert.doesNotMatch(cue.text, /\b(ki|aur|lekin|woh|iske)$/i, cue.text);
  }
  // The pause between 6.5s and 8s and the sentence end are kept as breaks.
  assert.ok(cues.some(c => c.end === 6.5 && /gaya\.$/.test(c.text)));
  assert.ok(cues.some(c => c.start === 8 && c.text.startsWith('Na koi')));
  assert.equal(cues.map(c => c.text).join(' '), 'Yeh website aisi thi ki iske content ko use karke masti chalta tha lekin woh masti kis level tak gaya. Na koi warning, na koi context.');
});
test('phrases keep every word in order and leave individually styled captions alone', () => {
  const styled = { start: 2, end: 4, text: 'one two three four five six seven', design: { ...defaultCaptionDesign, color: '#ff0000' } };
  const cues = phraseCues([{ start: 0, end: 2, text: 'alpha beta gamma delta epsilon zeta eta' }, styled]);
  assert.deepEqual(cues.at(-1), styled);
  assert.equal(cues.slice(0, -1).map(c => c.text).join(' '), 'alpha beta gamma delta epsilon zeta eta');
  assert.equal(validateCues(cues), null);
});
