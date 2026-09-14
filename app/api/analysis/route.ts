import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { CreateAnalysisSchema, MAX_RETRY_ROUNDS, MAX_VIDEO_SECONDS, analysisSetupMessage, clampWindowSeconds } from "@/lib/analysis/schema";
import { analysisRoot, cancelJob, createJob, getJob, getProgress, isWorkerOnline, listJobs, requestRetry } from "@/lib/analysis/store";
import { getYoutubeVideo } from "@/lib/youtube";

export const runtime = "nodejs";
const COOKIE = "momentscout-analysis";
function ownerOf(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  return token && /^[a-f0-9]{64}$/.test(token) ? createHash("sha256").update(token).digest("hex") : null;
}
function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") !== "cross-site" && (!origin || origin === new URL(request.url).origin);
}
async function smallBody(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 4096) { await reader.cancel(); throw new Error("Request too large"); }
    chunks.push(chunk.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function GET(request: NextRequest) {
  const owner = ownerOf(request);
  const id = request.nextUrl.searchParams.get("id");
  const workerOnline = await isWorkerOnline();
  if (!id) return reply({ configured: !analysisSetupMessage(process.env), setupMessage: analysisSetupMessage(process.env), maxDurationSeconds: MAX_VIDEO_SECONDS, workerOnline });
  const job = await getJob(id);
  if (!owner || !job || job.owner !== owner) return reply({ message: "Analysis not found or expired." }, 404);
  return reply({ id: job.id, durationSeconds: job.durationSeconds, ...await getProgress(job), workerOnline });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ message: "Cross-site analysis requests are not allowed." }, 403);
  let input;
  try { input = CreateAnalysisSchema.parse(await smallBody(request)); }
  catch { return reply({ message: "Supply a valid YouTube video ID." }, 400); }
  const setupMessage = analysisSetupMessage(process.env);
  if (setupMessage) return reply({ message: setupMessage }, 503);
  const newToken = randomBytes(32).toString("hex");
  const owner = ownerOf(request) ?? createHash("sha256").update(newToken).digest("hex");
  const creationLock = join(analysisRoot, "create.lock");
  await mkdir(analysisRoot, { recursive: true });
  try { await mkdir(creationLock); }
  catch { return reply({ message: "Another analysis is being queued. Try again shortly." }, 429); }
  try {
    const jobs = await listJobs();
    const owned = jobs.filter((job) => job.owner === owner);
    const sameVideo = owned.filter((job) => job.videoId === input.videoId).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    for (const existing of sameVideo) {
      const state = await getProgress(existing);
      if (state.status === "queued" || state.status === "running") return reply({ id: existing.id });
      const partial = state.failedWindows.length > 0;
      if (state.status === "complete" && !partial) return reply({ id: existing.id });
      if (partial && (state.status === "complete" || state.status === "failed")) {
        if (!input.retryFailed) return reply({ id: existing.id });
        if (state.retryRounds < MAX_RETRY_ROUNDS) {
          await requestRetry(existing.id);
          return reply({ id: existing.id }, 202);
        }
        if (state.status === "complete") return reply({ message: "Missed sections were already retried. Start a fresh analysis after this one expires." }, 409);
      }
      // Cancelled or fully failed analyses fall through to a fresh job.
    }
    if (owned.length >= 6 || jobs.length >= 20) return reply({ message: "The daily analysis limit has been reached. Try again after older jobs expire." }, 429);
    const states = await Promise.all(owned.map(getProgress));
    if (states.some((state) => state.status === "running" || state.status === "queued")) return reply({ message: "Finish or cancel your current analysis before starting another." }, 409);
    const video = await getYoutubeVideo(input.videoId);
    if (!video || !video.capabilities.canAnalyze || !video.durationSeconds) return reply({ message: "This public video is unavailable for analysis. Live or inaccessible sources cannot be analyzed." }, 422);
    if (video.durationSeconds > MAX_VIDEO_SECONDS) return reply({ message: "This release supports entire videos up to two hours. Longer-video analysis is not yet available." }, 422);
    const job = await createJob(owner, input.videoId, video.durationSeconds, clampWindowSeconds(process.env.ANALYSIS_WINDOW_SECONDS));
    const response = reply({ id: job.id }, 202);
    if (!ownerOf(request)) response.cookies.set(COOKIE, newToken, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", maxAge: 30 * 86400, path: "/" });
    return response;
  } catch { return reply({ message: "Could not queue analysis. Check the server connection and writable analysis storage." }, 500); }
  finally { await rm(creationLock, { recursive: true, force: true }); }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ message: "Cross-site requests are not allowed." }, 403);
  const id = request.nextUrl.searchParams.get("id");
  const owner = ownerOf(request);
  const job = id ? await getJob(id) : null;
  if (!owner || !job || job.owner !== owner) return reply({ message: "Analysis not found or expired." }, 404);
  await cancelJob(job.id);
  return reply({ status: "cancelled" });
}
