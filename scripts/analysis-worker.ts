import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  analysisRoot, cleanupJobs, clearRetryRequest, getProgress, isCancelled, listJobs, retryRequested, workerLock, writeHeartbeat, writeProgress,
} from "../lib/analysis/store.ts";
import { AnalysisError, MAX_RETRY_ROUNDS, analysisWindows, mergeHighlights, mergeTopics, pickProfile } from "../lib/analysis/schema.ts";
import type { AnalysisJob, AnalysisProgress, AnalysisRole, AnalysisWindow } from "../lib/analysis/schema.ts";
import { providerOf, roleModels } from "../lib/analysis/models.ts";
import type { Provider } from "../lib/analysis/models.ts";
import { analyzeSection, choosePlan, planAnalysis, planningSample, visualPassMode } from "../lib/analysis/pipeline.ts";
import type { RoleRunner } from "../lib/analysis/pipeline.ts";
import { fetchNativeTranscript, transcriptForWindow } from "../lib/analysis/transcript.ts";
import { captionRecovery, captionRetryDue } from "../lib/analysis/caption-recovery.ts";

// A single local worker owns progress writes. Requests only create jobs and cancel/retry flags.
// Sections run in parallel; each provider has its own request limit, so slow footage scans never hold
// up transcript reading.
const GEMINI_REQUESTS = Math.min(4, Math.max(1, Math.floor(Number(process.env.ANALYSIS_CONCURRENCY)) || 2));
const CLAUDE_REQUESTS = 4;
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
const elapsed = (ms: number) => `${Math.round(ms / 1000)}s`;

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

type Limit = <T>(task: () => Promise<T>) => Promise<T>;

function limiter(size: number): Limit {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    while (active >= size) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const limits: Record<Provider, Limit> = { gemini: limiter(GEMINI_REQUESTS), claude: limiter(CLAUDE_REQUESTS) };

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

async function processJob(job: AnalysisJob, initial: AnalysisProgress, models: Record<AnalysisRole, string[]>) {
  if (!captionRetryDue(initial)) return;
  const windows = analysisWindows(job.durationSeconds, job.windowSeconds);
  const controller = new AbortController();
  controllers.add(controller);
  const cancelPoll = setInterval(() => {
    void isCancelled(job.id).then((cancelled) => { if (cancelled) controller.abort(); }).catch(() => undefined);
  }, 1000);

  // Sections finish concurrently, so progress updates are applied in memory and written in order.
  let progress: AnalysisProgress = { ...initial, status: "running", message: undefined, nextCaptionAttemptAt: undefined, startedAt: now(), finishedAt: undefined, updatedAt: now() };
  let writes = Promise.resolve();
  const save = (update: (current: AnalysisProgress) => AnalysisProgress) => {
    progress = update(progress);
    const snapshot = progress;
    writes = writes.then(() => writeProgress(job.id, snapshot));
    return writes;
  };
  try {
  await save((current) => current);

  let lastError: string | null = null;
  // Each role walks its own model chain. A model that runs out of quota, loses its key or keeps failing
  // is skipped by every section for the rest of this job.
  const chains: Record<AnalysisRole, { models: string[]; index: number }> = {
    reader: { models: models.reader, index: 0 },
    reviewer: { models: models.reviewer, index: 0 },
    visual: { models: models.visual, index: 0 },
  };
  const run: RoleRunner = async (role, signal, task) => {
    const chain = chains[role];
    for (let attempt = 1; ; attempt++) {
      const model = chain.models[chain.index];
      if (!model) throw new AnalysisError(role === "visual" ? "Footage scanning needs GEMINI_API_KEY." : "No analysis model is configured.");
      try {
        const result = await limits[providerOf(model)](() => {
          signal.throwIfAborted();
          return task(model);
        });
        if (!progress.modelsByRole?.[role]?.includes(model)) {
          await save((current) => ({ ...current, modelsByRole: { ...current.modelsByRole, [role]: [...(current.modelsByRole?.[role] ?? []), model] } }));
        }
        return result;
      } catch (error) {
        if (signal.aborted || !(error instanceof AnalysisError)) throw error;
        if (error.quotaExhausted || error.unavailable || (error.retryable && attempt >= MAX_ATTEMPTS)) {
          if (chain.models[chain.index] === model && chain.index < chain.models.length - 1) chain.index++;
          if (chain.models[chain.index] !== model) {
            console.warn(`Job ${job.id}: ${role} unavailable on ${model} (${error.message}); continuing with ${chain.models[chain.index]}.`);
            attempt = 0;
            continue;
          }
        }
        if (!error.retryable || attempt >= MAX_ATTEMPTS) throw error;
        const wait = Math.min(90_000, (error.retryAfterMs ?? 5000 * 3 ** (attempt - 1)) + Math.random() * 1000);
        console.warn(`Job ${job.id}: ${role} attempt ${attempt} failed (${error.message}); retrying in ${Math.round(wait / 1000)}s.`);
        await delay(wait, signal);
      }
    }
  };

  if (!progress.transcriptSections?.length) {
    await save((current) => ({ ...current, phase: "fetching_transcript" }));
    const fetched = await fetchNativeTranscript(job.videoId, job.durationSeconds, controller.signal).catch((error) => {
      if (!controller.signal.aborted) throw error;
      return null;
    });
    if (fetched) {
      if (!fetched.transcript) lastError = fetched.notice ?? "Existing captions are unavailable for this video.";
      const recovery = !fetched.transcript ? captionRecovery(progress, fetched.retryAt, job.createdAt) : null;
      if (recovery && !controller.signal.aborted && !stopping) {
        await save((current) => ({ ...current, ...recovery, transcriptNotice: fetched.notice, updatedAt: now() }));
        console.log(`Job ${job.id}: caption retry ${progress.captionRetryCount}/6 scheduled for ${progress.nextCaptionAttemptAt}.`);
        return;
      }
      await save((current) => ({ ...current, transcriptNotice: fetched.notice,
        transcriptSections: fetched.transcript ? windows.map((window) => transcriptForWindow(fetched.transcript!, window)) : [],
        failedWindows: fetched.transcript ? current.failedWindows : windows.map((window) => window.index),
      }));
    }
  }

  // A quick planning read decides whether footage scans are worth their time and shares one label
  // vocabulary, so every section can start at once.
  const visualOptions = { visualAvailable: models.visual.length > 0, mode: visualPassMode(process.env.ANALYSIS_VISUAL_PASS) };
  if (!progress.plan && progress.transcriptSections?.length && !controller.signal.aborted) {
    await save((current) => ({ ...current, phase: "planning" }));
    const sample = planningSample(job, progress.transcriptSections);
    const draft = sample.excerpts.length
      ? await run("reader", controller.signal, (model) => planAnalysis(job, sample.excerpts, model, controller.signal)).catch((error) => {
        if (!controller.signal.aborted) console.warn(`Job ${job.id}: planning failed (${error instanceof Error ? error.message : "unexpected error"}); scanning footage by default.`);
        return null;
      })
      : null;
    if (!controller.signal.aborted) {
      const decided = choosePlan(draft, sample.coverage, visualOptions);
      await save((current) => ({ ...current, plan: decided }));
      console.log(`Job ${job.id}: ${decided.visualReason}`);
    }
  }
  const plan = progress.plan ?? choosePlan(null, 0, visualOptions);

  async function runSection(window: AnalysisWindow) {
    if (controller.signal.aborted || stopping) return;
    try {
      const section = progress.transcriptSections?.find((entry) => entry.window === window.index);
      if (!section) throw new AnalysisError("Existing captions are unavailable for this section. Retry caption retrieval or choose another video.");
      const result = await analyzeSection(job, window, section, plan, run, controller.signal);
      if (controller.signal.aborted) return;
      const seconds = window.end - window.start;
      await save((current) => {
        const others = current.windowProfiles.filter((entry) => entry.window !== window.index);
        const windowProfiles = result.profile ? [...others, { window: window.index, seconds, profile: result.profile }] : others;
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
          reviewRemoved: (current.reviewRemoved ?? 0) + result.reviewRemoved,
          updatedAt: now(),
        };
      });
      const { transcriptMs, footageMs } = result.timings;
      console.log(`Job ${job.id}: section ${window.index + 1}/${windows.length} done (transcript and cross-check ${elapsed(transcriptMs)}, footage ${footageMs === null ? "skipped" : elapsed(footageMs)}; ${result.highlights.length} highlights, ${result.topics.length} topics, ${result.reviewRemoved} removed by cross-check, ${result.rejected} rejected).`);
    } catch (error) {
      if (controller.signal.aborted || stopping) return;
      lastError = error instanceof AnalysisError ? error.message : "Unexpected analysis error.";
      if (!(error instanceof AnalysisError)) console.error(error);
      await save((current) => ({ ...current, failedWindows: [...new Set([...current.failedWindows, window.index])], updatedAt: now() }));
      console.error(`Job ${job.id}: section ${window.index + 1} failed: ${lastError}`);
    }
  }

  const pending = windows.filter((window) => !progress.completedWindows.includes(window.index) && !progress.failedWindows.includes(window.index));
  if (pending.length && !controller.signal.aborted) {
    await save((current) => ({ ...current, phase: "analyzing" }));
    console.log(`Analyzing job ${job.id}: ${pending.length} of ${windows.length} section(s) in parallel${plan.visualPass ? ", with footage scans" : ""}.`);
    await Promise.all(pending.map(runSection));
  }

  await writes;
  if (stopping) return;
  if (await isCancelled(job.id)) {
    await save((current) => ({ ...current, status: "cancelled", updatedAt: now() }));
    return;
  }
  await save((current) => {
    const done = current.completedWindows.length;
    const finished = { ...current, finishedAt: now(), updatedAt: now() };
    if (done === current.totalWindows) return { ...finished, status: "complete", message: undefined };
    const missed = current.totalWindows - done;
    return {
      ...finished,
      status: done > 0 ? "complete" : "failed",
      message: done > 0 ? `${missed} of ${current.totalWindows} sections could not be analyzed. ${lastError ?? ""}`.trim() : lastError ?? "Analysis failed.",
    };
  });
  console.log(`Job ${job.id} finished: ${progress.status} in ${elapsed(Date.parse(progress.finishedAt!) - Date.parse(progress.startedAt!))}.`);
  } finally {
    clearInterval(cancelPoll);
    controllers.delete(controller);
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("Set GEMINI_API_KEY and/or ANTHROPIC_API_KEY in .env.local before starting the analysis worker.");
  }
  const models = roleModels();
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
  const chain = (list: string[]) => list.join(" -> ") || "off";
  console.log(`Video analysis worker ready (transcript: ${chain(models.reader)}; cross-check: ${chain(models.reviewer)}; footage: ${chain(models.visual)}). Waiting for jobs.`);
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
            progress = { ...progress, status: "queued", failedWindows: [], retryRounds: progress.retryRounds + 1,
              captionRetryCount: 0, nextCaptionAttemptAt: undefined, message: undefined };
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
