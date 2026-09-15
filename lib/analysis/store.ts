import { mkdir, readFile, writeFile, rename, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { JOB_TTL_MS, JOB_VERSION, analysisWindows } from "./schema.ts";
import type { AnalysisJob, AnalysisProgress } from "./schema.ts";

// The default stays statically scoped so the Next build doesn't trace the whole project.
export const analysisRoot = process.env.ANALYSIS_DATA_DIR
  ? resolve(/* turbopackIgnore: true */ process.env.ANALYSIS_DATA_DIR)
  : join(process.cwd(), ".data", "analysis");
export const workerLock = join(analysisRoot, "worker.lock");
const HEARTBEAT_STALE_MS = 20_000;
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function jobPath(id: string) {
  if (!validId.test(id)) throw new Error("Invalid analysis ID");
  return join(analysisRoot, id);
}

// Windows can briefly report EPERM/EBUSY while the worker atomically replaces a file.
async function withFsRetry<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((done) => setTimeout(done, 25 * (attempt + 1)));
    }
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await withFsRetry(() => readFile(file, "utf8"))) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function exists(file: string) {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function isCurrent(job: AnalysisJob | null): job is AnalysisJob {
  return job !== null && job.version === JOB_VERSION && Date.now() - Date.parse(job.createdAt) < JOB_TTL_MS;
}

export async function listJobs(): Promise<AnalysisJob[]> {
  await mkdir(analysisRoot, { recursive: true });
  const names = (await readdir(analysisRoot)).filter((name) => validId.test(name));
  const jobs = await Promise.all(names.map((id) => readJson<AnalysisJob>(join(jobPath(id), "job.json"))));
  return jobs.filter(isCurrent);
}

export async function getJob(id: string) {
  if (!validId.test(id)) return null;
  const job = await readJson<AnalysisJob>(join(jobPath(id), "job.json"));
  return isCurrent(job) ? job : null;
}

/** The newest analysis of a video that wasn't cancelled. Every visitor shares it. */
export async function latestJobForVideo(videoId: string) {
  const jobs = (await listJobs()).filter((job) => job.videoId === videoId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const job of jobs) {
    if ((await getProgress(job)).status !== "cancelled") return job;
  }
  return null;
}

export function emptyProgress(job: AnalysisJob): AnalysisProgress {
  return {
    status: "queued",
    totalWindows: analysisWindows(job.durationSeconds, job.windowSeconds).length,
    completedWindows: [],
    failedWindows: [],
    coveredSeconds: 0,
    profile: null,
    windowProfiles: [],
    highlights: [],
    topics: [],
    rejectedSuggestions: 0,
    retryRounds: 0,
    updatedAt: job.createdAt,
  };
}

export async function getProgress(job: AnalysisJob): Promise<AnalysisProgress> {
  const progress = (await readJson<AnalysisProgress>(join(jobPath(job.id), "progress.json"))) ?? emptyProgress(job);
  if (await isCancelled(job.id)) return { ...progress, status: "cancelled" };
  return progress;
}

export async function writeProgress(id: string, progress: AnalysisProgress) {
  const temp = join(jobPath(id), `progress-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(progress), { mode: 0o600 });
  await withFsRetry(() => rename(temp, join(jobPath(id), "progress.json")));
}

export async function createJob(owner: string, videoId: string, durationSeconds: number, windowSeconds: number) {
  const job: AnalysisJob = {
    version: JOB_VERSION, id: randomUUID(), owner, videoId, durationSeconds, windowSeconds, createdAt: new Date().toISOString(),
  };
  await mkdir(jobPath(job.id), { recursive: true });
  await writeFile(join(jobPath(job.id), "job.json"), JSON.stringify(job), { flag: "wx", mode: 0o600 });
  return job;
}

export async function cancelJob(id: string) {
  await writeFile(join(jobPath(id), "cancelled"), "1", { mode: 0o600 });
}

export function isCancelled(id: string) {
  return exists(join(jobPath(id), "cancelled"));
}

/** Requests only leave flags; the worker remains the single writer of progress. */
export async function requestRetry(id: string) {
  await writeFile(join(jobPath(id), "retry"), new Date().toISOString(), { mode: 0o600 });
}

export function retryRequested(id: string) {
  return exists(join(jobPath(id), "retry"));
}

export async function clearRetryRequest(id: string) {
  await rm(join(jobPath(id), "retry"), { force: true });
}

/** Removes expired jobs and jobs written by an older analysis format. */
export async function cleanupJobs() {
  await mkdir(analysisRoot, { recursive: true });
  for (const id of (await readdir(analysisRoot)).filter((name) => validId.test(name))) {
    const job = await readJson<AnalysisJob>(join(jobPath(id), "job.json"));
    // A folder without job.json may be mid-creation; leave it alone.
    if (job && !isCurrent(job)) await rm(jobPath(id), { recursive: true, force: true });
  }
}

export async function writeHeartbeat() {
  await writeFile(join(workerLock, "heartbeat"), new Date().toISOString());
}

export async function isWorkerOnline() {
  try {
    const at = Date.parse(await readFile(join(workerLock, "heartbeat"), "utf8"));
    return Number.isFinite(at) && Date.now() - at < HEARTBEAT_STALE_MS;
  } catch {
    return false;
  }
}
