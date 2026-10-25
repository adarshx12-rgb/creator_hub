import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

// Personal-use YouTube clip downloads via yt-dlp. Off unless PERSONAL_DOWNLOADS=1, and only served
// to localhost (see app/api/download/route.ts). Jobs live in this process's memory; files expire.

export const QUALITIES = ["720", "1080", "best"] as const;
export type Quality = (typeof QUALITIES)[number];

export interface DownloadJob {
  id: string;
  videoId: string;
  startSeconds: number;
  endSeconds: number;
  quality: Quality;
  status: "running" | "complete" | "failed";
  error: string | null;
  filePath: string | null;
  fileName: string;
  createdAt: number;
}

const DOWNLOAD_ROOT = process.env.DOWNLOAD_DATA_DIR || join(process.cwd(), ".data", "downloads");
const EXPIRY_MS = 24 * 3600 * 1000;
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_RUNNING = 2;

const store = globalThis as unknown as { __momentscoutDownloads?: Map<string, DownloadJob> };
const jobs = (store.__momentscoutDownloads ??= new Map());

export function downloadsEnabled() {
  return process.env.PERSONAL_DOWNLOADS === "1";
}

export function maxClipSeconds() {
  const value = Number(process.env.DOWNLOAD_MAX_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : 3 * 3600;
}

function ytDlpPath() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  // winget installs don't reach an already-running shell's PATH, so check its package folder too.
  const winget = process.env.LOCALAPPDATA
    && join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages", "yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe", "yt-dlp.exe");
  return winget && existsSync(winget) ? winget : "yt-dlp";
}

function formatSelector(quality: Quality) {
  const cap = quality === "best" ? "" : `[height<=${quality}]`;
  // Prefer H.264/AAC in MP4 so the file plays everywhere; fall back to whatever is available.
  return `bv*${cap}[ext=mp4]+ba[ext=m4a]/b${cap}[ext=mp4]/bv*${cap}+ba/b${cap}/b`;
}

function stamp(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

async function sweepExpired() {
  for (const [id, job] of jobs) {
    if (Date.now() - job.createdAt > EXPIRY_MS && job.status !== "running") jobs.delete(id);
  }
  const entries = await readdir(DOWNLOAD_ROOT).catch(() => []);
  await Promise.all(entries.map(async (name) => {
    const path = join(DOWNLOAD_ROOT, name);
    const info = await stat(path).catch(() => null);
    if (info && Date.now() - info.mtimeMs > EXPIRY_MS) await rm(path, { recursive: true, force: true });
  }));
}

export function getDownload(id: string) {
  return jobs.get(id) ?? null;
}

export async function startDownload(videoId: string, startSeconds: number, endSeconds: number, quality: Quality) {
  await sweepExpired();
  // Repeated clicks on the same range reuse the running or finished job instead of downloading twice.
  for (const job of jobs.values()) {
    if (job.videoId === videoId && job.startSeconds === startSeconds && job.endSeconds === endSeconds
      && job.quality === quality && job.status !== "failed") return job;
  }
  if ([...jobs.values()].filter((job) => job.status === "running").length >= MAX_RUNNING) {
    throw new Error("Two downloads are already running. Wait for one to finish.");
  }

  const id = randomUUID();
  const dir = join(DOWNLOAD_ROOT, id);
  await mkdir(dir, { recursive: true });
  const job: DownloadJob = {
    id, videoId, startSeconds, endSeconds, quality,
    status: "running", error: null, filePath: null,
    fileName: `${videoId}_${stamp(startSeconds)}-${stamp(endSeconds)}.mp4`,
    createdAt: Date.now(),
  };
  jobs.set(id, job);

  const args = [
    "--no-playlist", "--no-progress", "--no-warnings", "--restrict-filenames",
    "-f", formatSelector(quality),
    "--merge-output-format", "mp4",
    "--download-sections", `*${startSeconds}-${endSeconds}`,
    "--force-keyframes-at-cuts",
    "-P", dir,
    "-o", "clip.%(ext)s",
    ...(process.env.FFMPEG_PATH ? ["--ffmpeg-location", process.env.FFMPEG_PATH] : []),
    "--", `https://www.youtube.com/watch?v=${videoId}`,
  ];
  const child = spawn(ytDlpPath(), args, { windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const timer = setTimeout(() => child.kill(), TIMEOUT_MS);

  const fail = async (message: string) => {
    job.status = "failed";
    job.error = message;
    await rm(dir, { recursive: true, force: true });
  };
  child.on("error", (error: NodeJS.ErrnoException) => {
    clearTimeout(timer);
    void fail(error.code === "ENOENT"
      ? "yt-dlp is not installed or not on PATH. Install it (winget install yt-dlp.yt-dlp) or set YTDLP_PATH."
      : "Could not start yt-dlp.");
  });
  child.on("close", async (code) => {
    clearTimeout(timer);
    if (job.status === "failed") return;
    const output = (await readdir(dir).catch(() => [])).find((name) => name.endsWith(".mp4"));
    if (code === 0 && output) {
      job.filePath = join(dir, output);
      job.status = "complete";
      return;
    }
    const reason = stderr.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("ERROR:")).pop();
    console.error(`[download ${id}] yt-dlp exited ${code}: ${reason ?? "no error line"}`);
    await fail(reason ? reason.replace(/^ERROR:\s*/, "").slice(0, 300) : code === null ? "Download timed out." : "yt-dlp failed to download this clip.");
  });

  return job;
}
