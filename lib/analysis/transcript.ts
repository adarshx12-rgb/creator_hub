import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import type { AnalysisWindow } from "./schema.ts";
import type { TranscriptSection, TranscriptSegment } from "./shared.ts";

export function parseNativeTranscript(input: unknown, duration: number) {
  const parsed = z.object({ lang: z.string().min(1).max(60), content: z.array(z.object({
    text: z.string().trim().min(1).max(3000), offset: z.number().finite().nonnegative(), duration: z.number().finite().positive(),
  })).max(20000) }).safeParse(input);
  if (!parsed.success) throw new Error("Invalid caption response");
  const segments = parsed.data.content.map((cue) => ({
    startSeconds: cue.offset / 1000, endSeconds: Math.min(duration, (cue.offset + cue.duration) / 1000), text: cue.text,
  })).sort((a, b) => a.startSeconds - b.startSeconds);
  if (segments.some((cue) => cue.startSeconds >= duration || cue.endSeconds <= cue.startSeconds)) throw new Error("Invalid caption timestamps");
  return { language: parsed.data.lang, segments };
}

/** Native captions adapter. No media downloading or browser cookies required. */
export async function fetchNativeTranscript(videoId: string, duration: number, signal: AbortSignal) {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid video ID");
  const key = process.env.SUPADATA_API_KEY;
  if (!key) return { transcript: null, notice: "Existing captions are not connected. Add SUPADATA_API_KEY to the server environment." };
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const params = new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, mode: "native", text: "false" });
  const base = "https://api.supadata.ai/v1/transcript";
  try {
    let response = await fetch(`${base}?${params}`, { headers: { "x-api-key": key }, signal: bounded, cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error("Caption retrieval failed");
    let data = await response.json();
    if (data.jobId) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(data.jobId)) throw new Error("Invalid transcript job");
      const jobId: string = data.jobId;
      for (let attempt = 0; attempt < 15; attempt++) {
        await delay(3000, undefined, { signal: bounded });
        response = await fetch(`${base}/${encodeURIComponent(jobId)}`, { headers: { "x-api-key": key }, signal: bounded, cache: "no-store", redirect: "error" });
        if (!response.ok) throw new Error("Caption retrieval failed");
        data = await response.json();
        if (data.status === "failed") throw new Error("Caption retrieval failed");
        if (data.status === "completed") { data = data.result ?? data; break; }
      }
    }
    return { transcript: parseNativeTranscript(data, duration), notice: undefined };
  } catch {
    signal.throwIfAborted();
    return { transcript: null, notice: "Existing captions could not be retrieved. Retry or choose a video with available captions." };
  }
}

export function transcriptForWindow(native: { language: string; segments: TranscriptSegment[] }, window: AnalysisWindow): TranscriptSection {
  return { window: window.index, source: "youtube_captions", language: native.language,
    segments: native.segments.filter((cue) => cue.endSeconds > window.inputStart && cue.startSeconds < window.end)
      .map((cue) => ({ ...cue, startSeconds: Math.max(window.inputStart, cue.startSeconds), endSeconds: Math.min(window.end, cue.endSeconds) })),
  };
}

export function transcriptPrompt(section: TranscriptSection): string {
  return JSON.stringify({ source: section.source, language: section.language, cues: section.segments });
}
