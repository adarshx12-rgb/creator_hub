import { mkdir, readFile, writeFile, rename, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { JOB_TTL_MS, analysisWindows } from "./schema.ts";
import type { AnalysisJob, AnalysisProgress, AnalysisMode } from "./schema.ts";

export const analysisRoot = resolve(process.env.ANALYSIS_DATA_DIR || ".data/analysis");
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function jobPath(id: string) {
  if (!validId.test(id)) throw new Error("Invalid analysis ID");
  return join(analysisRoot, id);
}
async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
export async function listJobs(): Promise<AnalysisJob[]> {
  await mkdir(analysisRoot, { recursive: true });
  const names = (await readdir(analysisRoot)).filter((name) => validId.test(name));
  const jobs = await Promise.all(names.map((id) => readJson<AnalysisJob>(join(jobPath(id), "job.json"))));
  return jobs.filter((job): job is AnalysisJob => job !== null);
}
export async function getJob(id: string) {
  if (!validId.test(id)) return null;
  const job = await readJson<AnalysisJob>(join(jobPath(id), "job.json"));
  if (!job || Date.now() - Date.parse(job.createdAt) >= JOB_TTL_MS) return null;
  return job;
}
export async function getProgress(job: AnalysisJob): Promise<AnalysisProgress> {
  const progress = await readJson<AnalysisProgress>(join(jobPath(job.id), "progress.json")) ?? {
    status: "queued", completedWindows: 0,
    totalWindows: analysisWindows(job.durationSeconds, job.mode).length,
    coveredSeconds: 0, segments: [], updatedAt: job.createdAt,
  };
  if (await isCancelled(job.id)) return { ...progress, status: "cancelled" };
  return progress;
}
export async function writeProgress(id: string, progress: AnalysisProgress) {
  const temp = join(jobPath(id), `progress-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(progress), { mode: 0o600 });
  await rename(temp, join(jobPath(id), "progress.json"));
}
export async function createJob(owner: string, videoId: string, mode: AnalysisMode, durationSeconds: number) {
  const job: AnalysisJob = { id: randomUUID(), owner, videoId, mode, durationSeconds, createdAt: new Date().toISOString() };
  await mkdir(jobPath(job.id), { recursive: true });
  await writeFile(join(jobPath(job.id), "job.json"), JSON.stringify(job), { flag: "wx", mode: 0o600 });
  return job;
}
export async function cancelJob(id: string) {
  await writeFile(join(jobPath(id), "cancelled"), "1", { mode: 0o600 });
}
export async function isCancelled(id: string) {
  try { await readFile(join(jobPath(id), "cancelled")); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function cleanupJobs() {
  for (const job of await listJobs()) {
    if (Date.now() - Date.parse(job.createdAt) >= JOB_TTL_MS) await rm(jobPath(job.id), { recursive: true, force: true });
  }
}
