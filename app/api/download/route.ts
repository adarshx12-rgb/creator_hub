import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { QUALITIES, downloadsEnabled, getDownload, maxClipSeconds, startDownload } from "@/lib/personal-download";
import { getYoutubeVideo } from "@/lib/youtube";

export const runtime = "nodejs";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const CreateDownloadSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  startSeconds: z.number().finite().min(0),
  endSeconds: z.number().finite().positive(),
  quality: z.enum(QUALITIES).default("1080"),
});

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

// Personal-use feature: refuse unless explicitly enabled and the request is to this machine.
function blocked(request: NextRequest) {
  if (!downloadsEnabled()) return reply({ message: "Personal downloads are off. Set PERSONAL_DOWNLOADS=1 in .env.local." }, 404);
  // nextUrl reflects the server's bind address, not what the client asked for, so read the Host header.
  const host = (request.headers.get("host") ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host) || !LOCAL_HOSTS.has(request.nextUrl.hostname)) return reply({ message: "Downloads are only available on localhost." }, 403);
  return null;
}

function publicJob(job: NonNullable<ReturnType<typeof getDownload>>) {
  return { id: job.id, status: job.status, error: job.error, fileName: job.fileName, startSeconds: job.startSeconds, endSeconds: job.endSeconds };
}

export async function GET(request: NextRequest) {
  const denied = blocked(request);
  if (denied) return denied;
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return reply({ enabled: true, maxClipSeconds: maxClipSeconds() });
  const job = getDownload(id);
  if (!job) return reply({ message: "Download not found or expired." }, 404);
  if (request.nextUrl.searchParams.get("file") !== "1") return reply(publicJob(job));

  if (job.status !== "complete" || !job.filePath) return reply({ message: "This download isn't ready yet." }, 409);
  const info = await stat(job.filePath).catch(() => null);
  if (!info) return reply({ message: "The downloaded file has expired. Download it again." }, 410);
  const body = Readable.toWeb(createReadStream(job.filePath)) as ReadableStream;
  return new Response(body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${job.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: NextRequest) {
  const denied = blocked(request);
  if (denied) return denied;
  if (request.headers.get("sec-fetch-site") === "cross-site") return reply({ message: "Cross-site requests are not allowed." }, 403);

  let input;
  try { input = CreateDownloadSchema.parse(await request.json()); }
  catch { return reply({ message: "Supply a video ID, a start and end time, and a quality." }, 400); }

  const video = await getYoutubeVideo(input.videoId).catch(() => null);
  if (!video) return reply({ message: "This YouTube video could not be found." }, 404);
  const duration = video.durationSeconds;
  if (!duration) return reply({ message: "This video has no fixed duration (it may be live), so a range can't be cut." }, 422);
  const start = Math.round(input.startSeconds * 10) / 10;
  const end = Math.round(Math.min(input.endSeconds, duration) * 10) / 10;
  if (!(start < end)) return reply({ message: "The start time must be before the end time." }, 400);
  if (end - start > maxClipSeconds()) return reply({ message: `Clips can be at most ${Math.round(maxClipSeconds() / 60)} minutes long.` }, 400);

  try {
    const job = await startDownload(input.videoId, start, end, input.quality);
    return reply(publicJob(job), 202);
  } catch (error) {
    return reply({ message: error instanceof Error ? error.message : "Could not start the download." }, 429);
  }
}
