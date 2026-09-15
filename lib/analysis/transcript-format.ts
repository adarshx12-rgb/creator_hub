import { z } from "zod";

export function parseNativeTranscript(input: unknown, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Invalid video duration");
  const parsed = z.object({ lang: z.string().min(1).max(60), content: z.array(z.object({
    text: z.string().trim().min(1).max(3000), offset: z.number().finite().nonnegative(), duration: z.number().finite().positive(),
  })).min(1).max(20000) }).safeParse(input);
  if (!parsed.success) throw new Error("Invalid or empty caption response");
  const segments = parsed.data.content.map((cue) => ({
    startSeconds: cue.offset / 1000, endSeconds: Math.min(duration, (cue.offset + cue.duration) / 1000), text: cue.text,
  })).sort((a, b) => a.startSeconds - b.startSeconds);
  if (segments.some((cue) => cue.startSeconds >= duration || cue.endSeconds <= cue.startSeconds)) throw new Error("Invalid caption timestamps");
  return { language: parsed.data.lang, segments };
}

export type NativeTranscript = ReturnType<typeof parseNativeTranscript>;
