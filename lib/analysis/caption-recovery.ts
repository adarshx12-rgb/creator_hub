import type { AnalysisProgress } from "./shared.ts";
import { JOB_TTL_MS } from "./schema.ts";

/** Persist a delayed retry without sleeping inside a job or consuming manual section retries. */
export function captionRecovery(progress: AnalysisProgress, retryAt: number | undefined, createdAt: string, now = Date.now()): Partial<AnalysisProgress> | null {
  const rounds = progress.captionRetryCount ?? 0;
  if (!Number.isFinite(retryAt) || rounds >= 6) return null;
  const next = Math.max(retryAt!, now + 60000 * 2 ** rounds);
  if (next >= Date.parse(createdAt) + JOB_TTL_MS) return null;
  return {
    status: "queued", phase: "fetching_transcript", captionRetryCount: rounds + 1,
    nextCaptionAttemptAt: new Date(next).toISOString(), failedWindows: [], finishedAt: undefined,
    message: "Caption access is temporarily unavailable. The worker will retry automatically.",
  };
}

export function captionRetryDue(progress: AnalysisProgress, now = Date.now()) {
  return !progress.nextCaptionAttemptAt || !(Date.parse(progress.nextCaptionAttemptAt) > now);
}
