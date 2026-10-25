import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { renderPlan, type MediaInfo, type RenderSpec } from './render-spec.ts';
import { subtitles } from './captions.ts';
import { prepareRenderFonts, type ExportFont } from './render-fonts.ts';

export interface RenderJob {
  id: string; owner: string; status: 'uploading' | 'rendering' | 'complete' | 'failed' | 'cancelled';
  progress: number; message: string; fileName: string; createdAt: number;
  spec: RenderSpec; audio?: string; width?: number; height?: number; size?: number;
}
const root = resolve(process.cwd(), '.data', 'renders');
const state = globalThis as unknown as { __mp4RenderJobs?: Map<string, RenderJob>; __mp4Processes?: Map<string, ChildProcess>; __mp4Uploads?: Set<string> };
const jobs = state.__mp4RenderJobs ??= new Map<string, RenderJob>();
const processes = state.__mp4Processes ??= new Map<string, ChildProcess>();
const uploading = state.__mp4Uploads ??= new Set<string>();
export const MAX_RENDER_UPLOAD = 2 * 1024 * 1024 * 1024;
const EXPIRY = 24 * 3600_000;
const ID = /^[a-f0-9-]{36}$/;
function isCancelled(job: RenderJob) { return job.status === 'cancelled'; }
export function renderDirectory(id: string) {
  if (!ID.test(id)) throw new Error('Invalid export ID.');
  const path = resolve(root, id);
  if (!path.startsWith(root + sep)) throw new Error('Invalid export directory.');
  return path;
}
async function persist(job: RenderJob) { await writeFile(join(renderDirectory(job.id), 'job.json'), JSON.stringify(job)); }
export async function getRender(id: string, owner: string): Promise<RenderJob | null> {
  if (!ID.test(id)) return null;
  let job = jobs.get(id);
  if (!job) {
    try {
      job = JSON.parse(await readFile(join(renderDirectory(id), 'job.json'), 'utf8')) as RenderJob;
      if (job.status === 'rendering' || job.status === 'uploading') { job.status = 'failed'; job.message = 'The renderer restarted. Export this clip again.'; await persist(job); }
      jobs.set(id, job);
    } catch { return null; }
  }
  if (job.owner !== owner || Date.now() - job.createdAt > EXPIRY) return null;
  return job;
}
async function sweep() {
  await mkdir(root, { recursive: true });
  for (const id of await readdir(root)) {
    if (!ID.test(id) || processes.has(id) || uploading.has(id)) continue;
    const info = await stat(join(renderDirectory(id), 'job.json')).catch(() => null);
    if (info && Date.now() - info.mtimeMs > EXPIRY) { await rm(renderDirectory(id), { recursive: true, force: true }); jobs.delete(id); }
  }
  for (const job of jobs.values()) {
    if (job.status === 'uploading' && !uploading.has(job.id) && Date.now() - job.createdAt > 15 * 60_000) { job.status = 'failed'; job.message = 'Upload expired. Export again.'; await persist(job); }
  }
}
export async function createRender(owner: string, spec: RenderSpec, fonts: ExportFont[]) {
  await sweep();
  if ([...jobs.values()].filter(j => j.status === 'uploading' || j.status === 'rendering').length >= 2) throw new Error('Two exports are already active. Wait for one to finish.');
  const job: RenderJob = { id: randomUUID(), owner, status: 'uploading', progress: 0, message: 'Waiting for video upload', fileName: `${spec.fileName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]/gi, '_').slice(0, 100)}-captioned.mp4`, createdAt: Date.now(), spec };
  jobs.set(job.id, job);
  try {
    await mkdir(renderDirectory(job.id), { recursive: true });
    await persist(job);
    await writeFile(join(renderDirectory(job.id), 'fonts.json'), JSON.stringify(fonts));
    return job;
  } catch (error) { jobs.delete(job.id); throw error; }
}
export function publicRender(job: RenderJob) {
  const { id, status, progress, message, fileName, createdAt, audio, width, height, size } = job;
  return { id, status, progress, message, fileName, createdAt, audio, width, height, size };
}
function run(job: RenderJob, command: string, args: string[], seconds: number, progress?: (output: string) => void) {
  return new Promise<string>((resolveRun, reject) => {
    if (job.status === 'cancelled') { reject(new Error('Export cancelled.')); return; }
    const child = spawn(command, args, { cwd: renderDirectory(job.id), windowsHide: true });
    processes.set(job.id, child);
    let output = ''; let errors = ''; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, seconds * 1000);
    child.stdout?.on('data', (chunk: Buffer) => { const text = chunk.toString(); if (progress) progress(text); else output = (output + text).slice(-1024 * 1024); });
    child.stderr?.on('data', (chunk: Buffer) => { errors = (errors + chunk.toString()).slice(-8000); });
    child.on('error', error => { clearTimeout(timer); processes.delete(job.id); reject(error); });
    child.on('close', code => {
      clearTimeout(timer); processes.delete(job.id);
      if (code === 0 && !timedOut && job.status !== 'cancelled') resolveRun(output);
      else { console.error(`[render ${job.id}] ${errors}`); reject(new Error(timedOut ? 'Rendering exceeded the one-hour limit. Try a shorter range.' : job.status === 'cancelled' ? 'Export cancelled.' : 'FFmpeg could not render this media without conversion. Check the server log.')); }
    });
  });
}
export async function uploadRender(job: RenderJob, body: ReadableStream<Uint8Array> | null, signal: AbortSignal) {
  if (job.status !== 'uploading' || uploading.has(job.id)) throw new Error('This export is already uploading or rendering.');
  if (!body) throw new Error('The video upload is empty.');
  uploading.add(job.id);
  const reader = body.getReader();
  const file = await open(join(renderDirectory(job.id), 'source'), 'w');
  let size = 0;
  try {
    while (true) {
      if (signal.aborted || isCancelled(job)) throw new Error('Upload cancelled.');
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RENDER_UPLOAD) { await reader.cancel(); throw new Error('MP4 export supports source files up to 2 GB.'); }
      let offset = 0;
      while (offset < chunk.value.length) offset += (await file.write(chunk.value, offset)).bytesWritten;
    }
    if (signal.aborted || isCancelled(job)) throw new Error('Upload cancelled.');
    if (!size) throw new Error('The video upload is empty.');
  } catch (error) {
    job.status = signal.aborted || isCancelled(job) ? 'cancelled' : 'failed'; job.message = error instanceof Error ? error.message : 'Upload failed.';
    await persist(job); throw error;
  } finally {
    await file.close(); uploading.delete(job.id);
    if (job.status !== 'uploading') for (const name of ['source', 'fonts.json']) await rm(join(renderDirectory(job.id), name), { force: true }).catch(() => {});
  }
  job.status = 'rendering'; job.message = 'Inspecting source quality'; await persist(job);
  void render(job);
}
async function render(job: RenderJob) {
  const dir = renderDirectory(job.id);
  try {
    const probe = await run(job, process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-f', job.spec.mimeType === 'video/webm' ? 'matroska' : 'mov', '-show_streams', '-show_format', '-of', 'json', 'source'], 60)
      .catch(error => { throw (error as NodeJS.ErrnoException).code === 'ENOENT' || job.status === 'cancelled' ? error : new Error('This file could not be read as a video. Upload an MP4, MOV, or WebM file.'); });
    const media = JSON.parse(probe) as MediaInfo;
    const plan = renderPlan(job.spec, media);
    const uploads = JSON.parse(await readFile(join(dir, 'fonts.json'), 'utf8')) as ExportFont[];
    const names = await prepareRenderFonts(dir, plan.cues, job.spec.design, uploads);
    // Output-side accurate seeking runs subtitle filters on source timestamps.
    const sourceCues = plan.cues.map(c => ({ ...c, start: c.start + job.spec.start, end: c.end + job.spec.start }));
    // Normal captions are burned in directly; difference-blend captions get their own layer (see renderPlan).
    for (const [file, blend] of [['captions.ass', 'normal'], ['difference.ass', 'difference']] as const) {
      if (blend === 'normal' ? !plan.normal : !plan.difference) continue;
      let ass = subtitles(sourceCues, 'ass', job.spec.design, 'original', { width: plan.width, height: plan.height }, blend);
      for (const [requested, actual] of names) ass = ass.replaceAll(`,${requested},`, `,${actual},`);
      await writeFile(join(dir, file), ass);
    }
    job.width = plan.width; job.height = plan.height; job.audio = plan.audio; job.message = plan.lossless ? 'Rendering lossless MP4' : 'Rendering MP4';
    const disk = await statfs(dir);
    // Leave headroom for the server and a second export. A capped/truncated file fails validation below.
    const maxBytes = Math.min(20 * 1024 ** 3, Math.floor((disk.bavail * disk.bsize - 1024 ** 3) / 2));
    if (maxBytes < 256 * 1024 ** 2) throw new Error('Not enough free disk space for this export.');
    plan.args.splice(plan.args.length - 1, 0, '-fs', String(maxBytes));
    let pending = '';
    await run(job, process.env.FFMPEG_PATH ?? 'ffmpeg', plan.args, 3600, chunk => {
      pending += chunk;
      const lines = pending.split(/\r?\n/); pending = lines.pop() ?? '';
      for (const line of lines) if (line.startsWith('out_time_us=')) job.progress = Math.min(99, Math.max(0, Number(line.slice(12)) / 1_000_000 / plan.duration * 100));
    });
    const output = JSON.parse(await run(job, process.env.FFPROBE_PATH ?? 'ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', 'output.mp4'], 60)) as MediaInfo;
    const video = output.streams.find(s => s.codec_type === 'video');
    if (video?.width !== plan.width || video.height !== plan.height || output.streams.filter(s => s.codec_type === 'audio').length !== media.streams.filter(s => s.codec_type === 'audio').length || Math.abs(Number(output.format.duration) - plan.duration) > .25) throw new Error('Export validation failed: dimensions, audio tracks, or duration changed unexpectedly.');
    job.size = (await stat(join(dir, 'output.mp4'))).size;
    job.status = 'complete'; job.progress = 100; job.message = `Ready. ${plan.audio}. Download available for 24 hours.`;
  } catch (error) {
    if (job.status !== 'cancelled') {
      job.status = 'failed'; job.message = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Install FFmpeg and ffprobe on the server, then export again.' : error instanceof Error ? error.message : 'Rendering failed.';
    }
  } finally {
    await persist(job).catch(error => console.error(`[render ${job.id}] Could not save final status:`, error));
    for (const name of ['source', 'fonts.json', 'captions.ass', 'difference.ass', 'fonts', ...(job.status === 'complete' ? [] : ['output.mp4'])]) await rm(join(dir, name), { recursive: true, force: true }).catch(() => {});
  }
}
export async function cancelRender(job: RenderJob) {
  if (job.status === 'complete' || job.status === 'failed') return;
  job.status = 'cancelled'; job.message = 'Export cancelled.';
  processes.get(job.id)?.kill(); await persist(job);
  if (!processes.has(job.id) && !uploading.has(job.id)) for (const name of ['source', 'fonts.json']) await rm(join(renderDirectory(job.id), name), { force: true }).catch(() => {});
}
