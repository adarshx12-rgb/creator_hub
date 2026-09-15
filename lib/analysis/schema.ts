import { z } from "zod";
import { CONTENT_TYPES, EVIDENCE_SOURCES, FOOTAGE_EVIDENCE_SOURCES, MAX_VIDEO_SECONDS, STRENGTHS, normalizeLabel } from "./shared.ts";
import type { AnalysisProgress, ContentType, Highlight, TopicChapter, VideoProfile } from "./shared.ts";

export * from "./shared.ts";

export const JOB_TTL_MS = 24 * 60 * 60 * 1000;
export const JOB_VERSION = 5;

export function analysisSetupMessage(env: Record<string, string | undefined> = process.env): string | null {
  const missing = ["YOUTUBE_API_KEY"].filter((name) => !env[name]);
  if (/^(0|false|off)$/i.test(env.TRANSCRIPT_SELF_HOSTED?.trim() ?? "") && !env.SUPADATA_API_KEY?.trim()) {
    missing.push("SUPADATA_API_KEY (or enable TRANSCRIPT_SELF_HOSTED)");
  }
  if (!env.GEMINI_API_KEY && !env.ANTHROPIC_API_KEY) missing.push("GEMINI_API_KEY or ANTHROPIC_API_KEY");
  return missing.length ? `Connect existing YouTube captions and analysis by adding ${missing.join(", ")} to the server environment, then restart the website.` : null;
}
/** Preceding footage included in each later section so boundary moments keep their lead-in. */
export const WINDOW_OVERLAP_SECONDS = 10;
export const MAX_WINDOW_SECONDS = 3600;
const MIN_WINDOW_SECONDS = 300;
export const TOLERANCE_SECONDS = 2;
export const MAX_HIGHLIGHT_SECONDS = 300;

export class AnalysisError extends Error {
  retryable: boolean;
  retryAfterMs: number | null;
  quotaExhausted: boolean;
  /** The model can't serve this job (missing or rejected key), so the worker moves to the role's next model. */
  unavailable: boolean;
  constructor(message: string, options: { retryable?: boolean; retryAfterMs?: number | null; quotaExhausted?: boolean; unavailable?: boolean } = {}) {
    super(message);
    this.name = "AnalysisError";
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.quotaExhausted = options.quotaExhausted ?? false;
    this.unavailable = options.unavailable ?? false;
  }
}

export const CreateAnalysisSchema = z.object({
  provider: z.literal("youtube"),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  retryFailed: z.literal(true).optional(),
}).strict();

export interface AnalysisJob {
  version: typeof JOB_VERSION;
  id: string;
  owner: string;
  videoId: string;
  durationSeconds: number;
  windowSeconds: number;
  createdAt: string;
}

export interface AnalysisWindow {
  index: number;
  start: number;
  inputStart: number;
  end: number;
}

const TIMESTAMP_PATTERN = /^(?:(\d+):)?(\d{1,3}):(\d{2})$/;
const Timestamp = z.string().regex(TIMESTAMP_PATTERN)
  .describe("MM:SS, or H:MM:SS at or past one hour, measured from the start of the original video");

const HighlightItem = z.object({
  start: Timestamp,
  end: Timestamp,
  label: z.string().min(1).max(32).describe("1-3 word title-case event type suited to this video, e.g. Drift, Near Miss, Hot Take, Story"),
  title: z.string().min(1).max(100),
  summary: z.string().min(1).max(300).describe("Why this moment stands out, paraphrased"),
  strength: z.enum(STRENGTHS).describe("How clip-worthy the content itself is; not a popularity prediction"),
  evidenceAt: Timestamp,
  evidenceSource: z.enum(EVIDENCE_SOURCES),
  evidence: z.string().min(1).max(240).describe("What is seen or heard at evidenceAt, paraphrased"),
});
const TopicItem = z.object({
  start: Timestamp,
  end: Timestamp,
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(300),
});

export const MAX_HIGHLIGHTS_PER_WINDOW = 30;
export const MAX_TOPICS_PER_WINDOW = 40;

/**
 * Shape requested from the footage scan. Verified live: Gemini rejects a schema with "invalid argument"
 * when arrays carry maxItems, so array limits live in the prompt and are enforced in validateWindow.
 */
export const VisualResponseSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  contentLabel: z.string().min(1).max(60),
  speechDriven: z.boolean(),
  summary: z.string().min(1).max(400),
  inspectedWholeRange: z.boolean(),
  highlights: z.array(HighlightItem.extend({ evidenceSource: z.enum(FOOTAGE_EVIDENCE_SOURCES) })),
});

// Text-role wire schemas are deliberately loose (no lengths, ranges or integer bounds): Claude's
// structured outputs and Gemini's JSON schema support differ, so limits are enforced per item in
// pipeline.ts, where one bad suggestion is discarded instead of failing a whole section.
const Profile = {
  contentType: z.enum(CONTENT_TYPES),
  contentLabel: z.string().describe("A short description of this kind of video, under 60 characters"),
  speechDriven: z.boolean(),
};

export const PlanResponseSchema = z.object({
  ...Profile,
  visualMomentsMatter: z.boolean().describe("True when clip-worthy moments are likely to be things seen on screen (plays, crashes, stunts, reactions) rather than things said"),
  labels: z.array(z.string()).describe("Up to 10 short title-case kinds of highlight suited to this video"),
});

export const ReaderResponseSchema = z.object({
  ...Profile,
  summary: z.string().describe("One sentence describing this section"),
  highlights: z.array(z.object({
    startCue: z.number(),
    endCue: z.number(),
    evidenceCue: z.number(),
    label: z.string().describe("1-3 word title-case kind of moment, e.g. Hot Take, Story, Advice"),
    title: z.string(),
    summary: z.string().describe("Why this moment stands out, paraphrased"),
    strength: z.enum(STRENGTHS).describe("How clip-worthy the content itself is; not a popularity prediction"),
    evidence: z.string().describe("What is said at evidenceCue, paraphrased"),
  })),
  topics: z.array(z.object({ startCue: z.number(), endCue: z.number(), title: z.string(), summary: z.string() })),
});

export const REVIEW_VERDICTS = ["keep", "revise", "reject"] as const;
export const ReviewResponseSchema = z.object({
  decisions: z.array(z.object({
    id: z.string(),
    verdict: z.enum(REVIEW_VERDICTS),
    start: z.number().optional().describe("Revised start in seconds from the start of the original video"),
    end: z.number().optional().describe("Revised end in seconds from the start of the original video"),
    label: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    strength: z.enum(STRENGTHS).optional(),
  })),
});

// Parsing is per item so one malformed suggestion is discarded instead of failing the whole section.
const Envelope = z.object({
  contentType: z.enum(CONTENT_TYPES),
  contentLabel: z.string().min(1),
  speechDriven: z.boolean(),
  summary: z.string(),
  inspectedWholeRange: z.boolean(),
  highlights: z.array(z.unknown()),
  topics: z.array(z.unknown()).default([]),
});

export function clampWindowSeconds(value: unknown): number {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return 600;
  return Math.min(MAX_WINDOW_SECONDS, Math.max(MIN_WINDOW_SECONDS, parsed));
}

export function analysisWindows(duration: number, windowSeconds = MAX_WINDOW_SECONDS): AnalysisWindow[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_VIDEO_SECONDS) throw new Error("Unsupported video duration");
  const size = clampWindowSeconds(windowSeconds);
  let count = Math.ceil(duration / size);
  // Fold a short tail into the previous section instead of spending a request on it.
  if (count > 1 && duration - (count - 1) * size < 120) count--;
  return Array.from({ length: count }, (_, index) => ({
    index,
    start: index * size,
    inputStart: Math.max(0, index * size - WINDOW_OVERLAP_SECONDS),
    end: index === count - 1 ? duration : (index + 1) * size,
  }));
}

export function parseTimestamp(value: string): number | null {
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  if (Number(seconds) >= 60 || (hours !== undefined && Number(minutes) >= 60)) return null;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatClock(totalSeconds: number): string {
  const value = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(value / 3600);
  const minutes = String(Math.floor((value % 3600) / 60)).padStart(2, "0");
  const seconds = String(value % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export interface WindowResult {
  profile: VideoProfile;
  highlights: Highlight[];
  topics: TopicChapter[];
  rejected: number;
}

export function validateWindow(input: unknown, window: AnalysisWindow, duration: number, strictTimestamps = false): WindowResult {
  const envelope = Envelope.safeParse(input);
  if (!envelope.success) throw new AnalysisError("The model returned an analysis in an unexpected format.", { retryable: true });
  const data = envelope.data;
  if (!data.inspectedWholeRange) throw new AnalysisError("Gemini could not inspect this whole section of the video.", { retryable: true });

  let rejected = 0;
  // The prompt asks for the strongest moments first when a limit applies, so extra items are dropped.
  data.highlights = data.highlights.slice(0, MAX_HIGHLIGHTS_PER_WINDOW);
  data.topics = data.topics.slice(0, MAX_TOPICS_PER_WINDOW);
  const highlightItems = data.highlights.flatMap((item) => {
    const parsed = HighlightItem.safeParse(item);
    if (!parsed.success) rejected++;
    return parsed.success ? [parsed.data] : [];
  });
  const topicItems = data.topics.flatMap((item) => {
    const parsed = TopicItem.safeParse(item);
    if (!parsed.success) rejected++;
    return parsed.success ? [parsed.data] : [];
  });

  // Gemini is asked for original-video time. If a clipped section came back relative to the
  // excerpt (every start fits the excerpt length and some fall before the excerpt), shift it.
  const starts = [...highlightItems, ...topicItems].map((item) => parseTimestamp(item.start)).filter((value) => value !== null);
  const excerptLength = window.end - window.inputStart;
  const offset = !strictTimestamps && window.inputStart > 0 && starts.length > 0
    && starts.every((value) => value <= excerptLength + TOLERANCE_SECONDS)
    && starts.some((value) => value < window.inputStart - TOLERANCE_SECONDS) ? window.inputStart : 0;

  const upper = Math.min(window.end, duration);
  function range(startText: string, endText: string) {
    const rawStart = parseTimestamp(startText);
    const rawEnd = parseTimestamp(endText);
    if (rawStart === null || rawEnd === null) return null;
    const start = rawStart + offset;
    const end = rawEnd + offset;
    if (start < window.inputStart - TOLERANCE_SECONDS || end > upper + TOLERANCE_SECONDS) return null;
    const clamped = { start: Math.max(window.inputStart, start), end: Math.min(upper, end) };
    return clamped.end > clamped.start ? clamped : null;
  }

  const highlights: Highlight[] = [];
  for (const item of highlightItems) {
    const bounds = range(item.start, item.end);
    const rawEvidence = parseTimestamp(item.evidenceAt);
    const evidenceAt = rawEvidence === null ? null : rawEvidence + offset;
    if (!bounds || bounds.end - bounds.start > MAX_HIGHLIGHT_SECONDS || evidenceAt === null
      || evidenceAt < bounds.start - TOLERANCE_SECONDS || evidenceAt > bounds.end + TOLERANCE_SECONDS) {
      rejected++;
      continue;
    }
    // Moments ending inside the overlap belong to the previous section.
    if (bounds.end <= window.start) continue;
    highlights.push({
      startSeconds: bounds.start, endSeconds: bounds.end, label: item.label.trim(), title: item.title.trim(),
      summary: item.summary.trim(), strength: item.strength,
      evidence: { atSeconds: Math.min(bounds.end, Math.max(bounds.start, evidenceAt)), source: item.evidenceSource, description: item.evidence.trim() },
    });
  }
  const topics: TopicChapter[] = [];
  for (const item of topicItems) {
    const bounds = range(item.start, item.end);
    if (!bounds) { rejected++; continue; }
    if (bounds.end <= window.start) continue;
    topics.push({ startSeconds: bounds.start, endSeconds: bounds.end, title: item.title.trim(), summary: item.summary.trim() });
  }

  return {
    profile: { contentType: data.contentType, contentLabel: data.contentLabel.trim().slice(0, 60), speechDriven: data.speechDriven, summary: data.summary.trim().slice(0, 400) },
    highlights: highlights.sort((a, b) => a.startSeconds - b.startSeconds),
    topics: topics.sort((a, b) => a.startSeconds - b.startSeconds),
    rejected,
  };
}

export function mergeHighlights(existing: Highlight[], incoming: Highlight[]): Highlight[] {
  const merged = [...existing];
  for (const highlight of incoming) {
    const duplicate = merged.some((other) => normalizeLabel(other.label) === normalizeLabel(highlight.label)
      && Math.abs(other.startSeconds - highlight.startSeconds) <= 5);
    if (!duplicate) merged.push(highlight);
  }
  return merged.sort((a, b) => a.startSeconds - b.startSeconds);
}

/** Joins a chapter split by a section boundary when both halves carry the same title. */
export function mergeTopics(existing: TopicChapter[], incoming: TopicChapter[]): TopicChapter[] {
  const result: TopicChapter[] = [];
  for (const topic of [...existing, ...incoming].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const previous = result.at(-1);
    if (previous && normalizeLabel(previous.title) === normalizeLabel(topic.title) && topic.startSeconds - previous.endSeconds <= 15) {
      previous.endSeconds = Math.max(previous.endSeconds, topic.endSeconds);
      continue;
    }
    result.push({ ...topic });
  }
  return result;
}

/** Overall profile: the content type covering the most analyzed time, described by its earliest section. */
export function pickProfile(entries: AnalysisProgress["windowProfiles"]): VideoProfile | null {
  if (entries.length === 0) return null;
  const ordered = [...entries].sort((a, b) => a.window - b.window);
  const totals = new Map<ContentType, number>();
  for (const entry of ordered) totals.set(entry.profile.contentType, (totals.get(entry.profile.contentType) ?? 0) + entry.seconds);
  const [contentType] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  const representative = ordered.find((entry) => entry.profile.contentType === contentType)!;
  const speechBalance = ordered.reduce((sum, entry) => sum + (entry.profile.speechDriven ? entry.seconds : -entry.seconds), 0);
  return { ...representative.profile, speechDriven: speechBalance > 0 };
}
