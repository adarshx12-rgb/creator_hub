import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { CreateAnalysisSchema, MAX_VIDEO_SECONDS, JOB_TTL_MS } from "@/lib/analysis/schema";
import { analysisRoot, cancelJob, createJob, getJob, getProgress, listJobs } from "@/lib/analysis/store";
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
  if (!id) return reply({ configured: Boolean(process.env.GEMINI_API_KEY && process.env.YOUTUBE_API_KEY), maxDurationSeconds: MAX_VIDEO_SECONDS });
  const job = await getJob(id);
  if (!owner || !job || job.owner !== owner) return reply({ message: "Analysis not found or expired." }, 404);
  return reply({ id: job.id, mode: job.mode, durationSeconds: job.durationSeconds, ...await getProgress(job) });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ message: "Cross-site analysis requests are not allowed." }, 403);
  let input;
  try { input = CreateAnalysisSchema.parse(await smallBody(request)); }
  catch { return reply({ message: "Supply a valid YouTube video ID and analysis mode." }, 400); }
  if (!process.env.GEMINI_API_KEY || !process.env.YOUTUBE_API_KEY) return reply({ message: "Add GEMINI_API_KEY and YOUTUBE_API_KEY to .env.local, then start the analysis worker." }, 503);
  const newToken = randomBytes(32).toString("hex");
  const owner = ownerOf(request) ?? createHash("sha256").update(newToken).digest("hex");
  const creationLock = join(analysisRoot, "create.lock");
  await mkdir(analysisRoot, { recursive: true });
  try { await mkdir(creationLock); }
  catch { return reply({ message: "Another analysis is being queued. Try again shortly." }, 429); }
  try {
    const jobs = (await listJobs()).filter((job) => Date.now() - Date.parse(job.createdAt) < JOB_TTL_MS);
    const owned = jobs.filter((job) => job.owner === owner);
    for (const existing of owned.filter((job) => job.videoId === input.videoId && job.mode === input.mode)) {
      const state = await getProgress(existing);
      if (["queued", "running", "complete"].includes(state.status)) return reply({ id: existing.id });
    }
    if (owned.length >= 6 || jobs.length >= 20) return reply({ message: "The daily analysis limit has been reached. Try again after older jobs expire." }, 429);
    const states = await Promise.all(owned.map(getProgress));
    if (states.some((state) => state.status === "running" || state.status === "queued")) return reply({ message: "Finish or cancel your current analysis before starting another." }, 409);
    const video = await getYoutubeVideo(input.videoId);
    if (!video || !video.capabilities.canAnalyze || !video.durationSeconds) return reply({ message: "This public video is unavailable for analysis. Live or inaccessible sources cannot be analyzed." }, 422);
    if (video.durationSeconds > MAX_VIDEO_SECONDS) return reply({ message: "This release supports entire videos up to two hours. Longer-video analysis is not yet available." }, 422);
    const job = await createJob(owner, input.videoId, input.mode, video.durationSeconds);
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
