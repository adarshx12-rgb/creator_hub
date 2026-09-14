import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  analysisRoot, cleanupJobs, clearRetryRequest, getProgress, isCancelled, listJobs, retryRequested, workerLock, writeHeartbeat, writeProgress,
} from "../lib/analysis/store.ts";
import { AnalysisError, MAX_RETRY_ROUNDS, analysisWindows, highlightLabels, mergeHighlights, mergeTopics, pickProfile } from "../lib/analysis/schema.ts";
import type { AnalysisJob, AnalysisProgress, AnalysisWindow } from "../lib/analysis/schema.ts";
import { analyzeWindow, configuredModels } from "../lib/analysis/gemini.ts";
import { fetchNativeTranscript, groundHighlights, transcriptForWindow, transcriptPrompt } from "../lib/analysis/transcript.ts";

// A single local worker owns progress writes. Requests only create jobs and cancel/retry flags.
const CONCURRENCY = Math.min(4, Math.max(1, Math.floor(Number(process.env.ANALYSIS_CONCURRENCY)) || 2));
const MAX_ATTEMPTS = 3;
let stopping = false;
const controllers = new Set<AbortController>();
for (const event of ["SIGINT", "SIGTERM"] as const) {
  process.on(event, () => {
    stopping = true;
    for (const controller of controllers) controller.abort();
  });
}

const now = () => new Date().toISOString();

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function acquireLock() {
  await mkdir(analysisRoot, { recursive: true });
  try {
    await mkdir(workerLock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const pid = Number(await readFile(join(workerLock, "pid"), "utf8").catch(() => ""));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Worker lock is incomplete. Check no worker is running before removing .data/analysis/worker.lock.");
    let live = true;
    try { process.kill(pid, 0); } catch (killError) { if ((killError as NodeJS.ErrnoException).code === "ESRCH") live = false; }
    if (live) throw Object.assign(new Error("An analysis worker is already running."), { code: "LOCK_HELD" });
    await rm(workerLock, { recursive: true, force: true });
    await mkdir(workerLock);
  }
  await writeFile(join(workerLock, "pid"), String(process.pid));
}

async function processJob(job: AnalysisJob, initial: AnalysisProgress, models: string[]) {
  const windows = analysisWindows(job.durationSeconds, job.windowSeconds);
  const controller = new AbortController();
  controllers.add(controller);
  const cancelPoll = setInterval(() => {
    void isCancelled(job.id).then((cancelled) => { if (cancelled) controller.abort(); }).catch(() => undefined);
  }, 1000);

  // Sections finish concurrently, so progress updates are applied in memory and written in order.
  let progress: AnalysisProgress = { ...initial, status: "running", message: undefined, updatedAt: now() };
  let writes = Promise.resolve();
  const save = (update: (current: AnalysisProgress) => AnalysisProgress) => {
    progress = update(progress);
    const snapshot = progress;
    writes = writes.then(() => writeProgress(job.id, snapshot));
    return writes;
  };
  await save((current) => current);

  let modelIndex = 0;
  let lastError: string | null = null;
  let quotaExhausted = false;

  if (!progress.transcriptSections?.length) {
    await save((current) => ({ ...current, phase: "fetching_transcript" }));
    const fetched = await fetchNativeTranscript(job.videoId, job.durationSeconds, controller.signal).catch((error) => {
      if (!controller.signal.aborted) throw error;
      return null;
    });
    if (fetched) {
      if (!fetched.transcript) lastError = fetched.notice ?? "Existing captions are unavailable for this video.";
      await save((current) => ({ ...current, transcriptNotice: fetched.notice,
        transcriptSections: fetched.transcript ? windows.map((window) => transcriptForWindow(fetched.transcript!, window)) : [],
        failedWindows: fetched.transcript ? current.failedWindows : windows.map((window) => window.index),
      }));
    }
  }

  async function analyze(window: AnalysisWindow) {
    for (let attempt = 1; ; attempt++) {
      const model = models[modelIndex];
      try {
        const transcript = progress.transcriptSections?.find((section) => section.window === window.index);
        if (!transcript) throw new AnalysisError("Existing captions are unavailable for this section. Retry caption retrieval or choose another video.");
        await save((current) => ({ ...current, phase: "analyzing", modelsUsed: [...new Set([...(current.modelsUsed ?? []), model])] }));
        const options = {
          model,
          signal: controller.signal,
          context: { profile: progress.profile, labels: highlightLabels(progress.highlights).map((entry) => entry.label) },
          transcript: transcriptPrompt(transcript),
        };
        const draft = await analyzeWindow(job, window, options);
        await save((current) => ({ ...current, phase: "verifying" }));
        const verified = await analyzeWindow(job, window, { ...options, draft });
        return groundHighlights({ ...verified, rejected: draft.rejected + verified.rejected }, transcript);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        if (error instanceof AnalysisError && (error.quotaExhausted || (error.retryable && attempt >= MAX_ATTEMPTS))) {
          if (models[modelIndex] === model && modelIndex < models.length - 1) modelIndex++;
          if (models[modelIndex] !== model) {
            console.warn(`Analysis unavailable on ${model}; continuing with ${models[modelIndex]}.`);
            attempt = 0;
            continue;
          }
          if (error.quotaExhausted) quotaExhausted = true;
        }
        if (!(error instanceof AnalysisError) || !error.retryable || attempt >= MAX_ATTEMPTS) throw error;
        const wait = Math.min(90_000, (error.retryAfterMs ?? 5000 * 3 ** (attempt - 1)) + Math.random() * 1000);
        console.warn(`Job ${job.id}: section ${window.index + 1} attempt ${attempt} failed (${error.message}); retrying in ${Math.round(wait / 1000)}s.`);
        await delay(wait, controller.signal);
      }
    }
  }

  async function runSection(window: AnalysisWindow) {
    if (controller.signal.aborted || stopping) return;
    try {
      if (quotaExhausted) throw new AnalysisError(lastError ?? "Gemini's daily quota is used up.", { quotaExhausted: true });
      const result = await analyze(window);
      if (controller.signal.aborted) return;
      const seconds = window.end - window.start;
      await save((current) => {
        const windowProfiles = [...current.windowProfiles.filter((entry) => entry.window !== window.index), { window: window.index, seconds, profile: result.profile }];
        return {
          ...current,
          completedWindows: [...current.completedWindows, window.index].sort((a, b) => a - b),
          failedWindows: current.failedWindows.filter((index) => index !== window.index),
          coveredSeconds: current.coveredSeconds + seconds,
          windowProfiles,
          profile: pickProfile(windowProfiles),
          highlights: mergeHighlights(current.highlights, result.highlights),
          topics: mergeTopics(current.topics, result.topics),
          rejectedSuggestions: current.rejectedSuggestions + result.rejected,
          updatedAt: now(),
        };
      });
      console.log(`Job ${job.id}: section ${window.index + 1}/${windows.length} done (${result.highlights.length} highlights, ${result.topics.length} topics, ${result.rejected} rejected).`);
    } catch (error) {
      if (controller.signal.aborted || stopping) return;
      lastError = error instanceof AnalysisError ? error.message : "Unexpected analysis error.";
      if (!(error instanceof AnalysisError)) console.error(error);
      await save((current) => ({ ...current, failedWindows: [...new Set([...current.failedWindows, window.index])], updatedAt: now() }));
      console.error(`Job ${job.id}: section ${window.index + 1} failed: ${lastError}`);
    }
  }

  const pending = windows.filter((window) => !progress.completedWindows.includes(window.index) && !progress.failedWindows.includes(window.index));
  console.log(`Analyzing job ${job.id}: ${pending.length} of ${windows.length} section(s), up to ${CONCURRENCY} at a time.`);
  // With nothing analyzed yet, run one section first so later sections share its content type and labels.
  if (progress.completedWindows.length === 0 && pending.length > 1) await runSection(pending.shift()!);
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
    for (let window = pending.shift(); window; window = pending.shift()) await runSection(window);
  }));

  clearInterval(cancelPoll);
  controllers.delete(controller);
  await writes;
  if (stopping) return;
  if (await isCancelled(job.id)) {
    await save((current) => ({ ...current, status: "cancelled", updatedAt: now() }));
    return;
  }
  await save((current) => {
    const done = current.completedWindows.length;
    if (done === current.totalWindows) return { ...current, status: "complete", message: undefined, updatedAt: now() };
    const missed = current.totalWindows - done;
    return {
      ...current,
      status: done > 0 ? "complete" : "failed",
      message: done > 0 ? `${missed} of ${current.totalWindows} sections could not be analyzed. ${lastError ?? ""}`.trim() : lastError ?? "Analysis failed.",
      updatedAt: now(),
    };
  });
  console.log(`Job ${job.id} finished: ${progress.status}.`);
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("Set GEMINI_API_KEY in .env.local before starting the analysis worker.");
  const models = configuredModels();
  // Set when the website started this worker: stop with it, and wait out a restarting server's old worker.
  const parentPid = Number(process.env.ANALYSIS_WORKER_PARENT_PID) || null;
  for (let attempt = 1; ; attempt++) {
    try {
      await acquireLock();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "LOCK_HELD" || !parentPid) throw error;
      if (attempt >= 15) {
        console.log("[analysis] Another analysis worker is already running; using that one.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  if (parentPid) {
    const watchParent = setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
        clearInterval(watchParent);
        stopping = true;
        for (const controller of controllers) controller.abort();
      }
    }, 3000);
    watchParent.unref();
  }
  await writeHeartbeat();
  const heartbeat = setInterval(() => void writeHeartbeat().catch(() => undefined), 5000);
  console.log(`Video analysis worker ready (${models.join(" -> ")}). Waiting for jobs.`);
  let lastCleanup = 0;
  try {
    while (!stopping) {
      if (Date.now() - lastCleanup > 60_000) {
        await cleanupJobs();
        lastCleanup = Date.now();
      }
      const jobs = (await listJobs()).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      for (const job of jobs) {
        if (stopping) break;
        let progress = await getProgress(job);
        if ((progress.status === "complete" || progress.status === "failed") && progress.failedWindows.length > 0 && await retryRequested(job.id)) {
          await clearRetryRequest(job.id);
          if (progress.retryRounds < MAX_RETRY_ROUNDS) {
            progress = { ...progress, status: "queued", failedWindows: [], retryRounds: progress.retryRounds + 1, message: undefined };
          }
        }
        if (progress.status === "queued" || progress.status === "running") await processJob(job, progress, models);
      }
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } finally {
    clearInterval(heartbeat);
    await rm(workerLock, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
