import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { analysisRoot, cleanupJobs, getProgress, isCancelled, listJobs, writeProgress } from "../lib/analysis/store.ts";
import { analysisWindows, mergeSegments } from "../lib/analysis/schema.ts";
import { analyzeWindow } from "../lib/analysis/gemini.ts";

// A single local worker owns progress writes. Requests only create jobs/cancel flags.
const lock = join(analysisRoot, "worker.lock");
let stopping = false;
let active: AbortController | null = null;
for (const event of ["SIGINT", "SIGTERM"] as const) process.on(event, () => { stopping = true; active?.abort(); });

async function acquireLock() {
  await mkdir(analysisRoot, { recursive: true });
  try { await mkdir(lock); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(join(lock, "pid"), "utf8").catch(() => ""));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Worker lock is incomplete. Check no worker is running before removing .data/analysis/worker.lock.");
    let live = true;
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") live = false; }
    if (live) throw new Error("An analysis worker is already running.");
    await rm(lock, { recursive: true, force: true });
    await mkdir(lock);
  }
  await writeFile(join(lock, "pid"), String(process.pid));
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in .env.local before starting the analysis worker.");
  await acquireLock();
  console.log("Video analysis worker ready. Waiting for jobs.");
  try {
    while (!stopping) {
      await cleanupJobs();
      const jobs = (await listJobs()).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      for (const job of jobs) {
        if (stopping) break;
        let progress = await getProgress(job);
        if (!["queued", "running"].includes(progress.status)) continue;
        const windows = analysisWindows(job.durationSeconds, job.mode);
        progress = { ...progress, status: "running", message: undefined, updatedAt: new Date().toISOString() };
        await writeProgress(job.id, progress);
        console.log(`Analyzing job ${job.id} (${job.mode}).`);
        for (let index = progress.completedWindows; index < windows.length && !stopping; index++) {
          active = new AbortController();
          const controller = active;
          const cancellation = setInterval(() => {
            void isCancelled(job.id).then((cancelled) => { if (cancelled) controller.abort(); }).catch(() => controller.abort());
          }, 1000);
          try {
            if (await isCancelled(job.id)) break;
            const segments = await analyzeWindow(job, windows[index], controller.signal);
            if (await isCancelled(job.id)) break;
            progress = { ...progress, completedWindows: index + 1, coveredSeconds: windows[index].end,
              segments: mergeSegments(progress.segments, segments),
              status: index === windows.length - 1 ? "complete" : "running", updatedAt: new Date().toISOString() };
            await writeProgress(job.id, progress);
          } catch (error) {
            if (stopping || await isCancelled(job.id)) break;
            progress = { ...progress, status: "failed", updatedAt: new Date().toISOString(),
              message: error instanceof Error && !error.name.startsWith("Zod")
                ? error.message.slice(0, 220) : "The model returned an invalid analysis. Completed windows have been preserved." };
            await writeProgress(job.id, progress);
            console.error(`Job ${job.id} failed; completed windows preserved.`);
            break;
          } finally { clearInterval(cancellation); active = null; }
        }
      }
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } finally { await rm(lock, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
