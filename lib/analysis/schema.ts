import { z } from "zod";

export const MAX_VIDEO_SECONDS = 7200;
export const JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const AnalysisModeSchema = z.enum(["topics", "gameplay"]);
export type AnalysisMode = z.infer<typeof AnalysisModeSchema>;
export const CreateAnalysisSchema = z.object({
  provider: z.literal("youtube"),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  mode: AnalysisModeSchema,
}).strict();

export const SegmentSchema = z.object({
  startSeconds: z.number().finite().nonnegative(),
  endSeconds: z.number().finite().positive(),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(600),
  kind: z.enum(["topic", "kill", "round_win", "ace", "clutch", "other"]),
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.array(z.object({
    atSeconds: z.number().finite().nonnegative(),
    source: z.enum(["speech", "kill_feed", "scoreboard", "banner", "visual"]),
    description: z.string().min(1).max(300),
  })).min(1).max(8),
});
export const WindowResponseSchema = z.object({
  inspectedWholeWindow: z.boolean(),
  segments: z.array(SegmentSchema).max(80),
});
export type AnalysisSegment = z.infer<typeof SegmentSchema>;
export interface AnalysisJob {
  id: string;
  owner: string;
  videoId: string;
  mode: AnalysisMode;
  durationSeconds: number;
  createdAt: string;
}
export interface AnalysisProgress {
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  completedWindows: number;
  totalWindows: number;
  coveredSeconds: number;
  segments: AnalysisSegment[];
  updatedAt: string;
  message?: string;
}
export interface AnalysisState extends AnalysisProgress {
  id: string;
  mode: AnalysisMode;
  durationSeconds: number;
}

export function analysisWindows(duration: number, mode: AnalysisMode) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) throw new Error("Unsupported video duration");
  const size = mode === "gameplay" ? 120 : 600;
  return Array.from({ length: Math.ceil(duration / size) }, (_, index) => ({
    start: index * size,
    inputStart: Math.max(0, index * size - 8),
    end: Math.min(duration, (index + 1) * size),
  }));
}

export function validateWindow(input: unknown, window: { start: number; inputStart: number; end: number }, mode: AnalysisMode): AnalysisSegment[] {
  const result = WindowResponseSchema.parse(input);
  if (!result.inspectedWholeWindow) throw new Error("The model could not inspect the entire requested window");
  for (const segment of result.segments) {
    if (segment.startSeconds < window.inputStart || segment.endSeconds > window.end || segment.startSeconds >= segment.endSeconds) throw new Error("The model returned an invalid timestamp range");
    if (segment.evidence.some((item) => item.atSeconds < segment.startSeconds || item.atSeconds > segment.endSeconds)) throw new Error("Evidence timestamp is outside its segment");
    if (mode === "topics" && segment.kind !== "topic") throw new Error("Unexpected event in topic analysis");
    if (mode === "gameplay" && (segment.kind === "topic" || !segment.evidence.some((item) => item.source !== "speech"))) throw new Error("Gameplay events require visual evidence");
    if (segment.kind === "ace" && !segment.evidence.some((item) => item.source === "banner" || item.source === "kill_feed")) throw new Error("An ace requires a visible banner or kill-feed evidence");
  }
  // Keep events that cross a boundary; their full outcome may only appear in this window.
  return result.segments.filter((segment) => segment.endSeconds > window.start)
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

export function mergeSegments(existing: AnalysisSegment[], incoming: AnalysisSegment[]) {
  const merged = [...existing];
  for (const segment of incoming) {
    if (!merged.some((other) => other.kind === segment.kind && other.title === segment.title &&
      Math.abs(other.startSeconds - segment.startSeconds) <= 3 && Math.abs(other.endSeconds - segment.endSeconds) <= 3)) merged.push(segment);
  }
  return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}
