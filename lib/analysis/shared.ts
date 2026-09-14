// Client-safe analysis types and helpers. Keep zod and Node APIs out of this file.

export const MAX_VIDEO_SECONDS = 7200;
/** How many times a user can re-run sections that failed after the worker's own retries. */
export const MAX_RETRY_ROUNDS = 2;

export const CONTENT_TYPES = [
  "podcast_interview",
  "talk_lecture",
  "gaming",
  "sports",
  "vehicles_motorsport",
  "vlog_lifestyle",
  "tutorial_howto",
  "music_performance",
  "news_commentary",
  "comedy_entertainment",
  "nature_animals",
  "other",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  podcast_interview: "Podcast / interview",
  talk_lecture: "Talk / lecture",
  gaming: "Gaming",
  sports: "Sports",
  vehicles_motorsport: "Vehicles / motorsport",
  vlog_lifestyle: "Vlog / lifestyle",
  tutorial_howto: "Tutorial / how-to",
  music_performance: "Music / performance",
  news_commentary: "News / commentary",
  comedy_entertainment: "Comedy / entertainment",
  nature_animals: "Nature / animals",
  other: "Other",
};

export const STRENGTHS = ["high", "medium", "low"] as const;
export type Strength = (typeof STRENGTHS)[number];
export const EVIDENCE_SOURCES = ["speech", "visual", "on_screen_text", "sound"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export interface VideoProfile {
  contentType: ContentType;
  contentLabel: string;
  speechDriven: boolean;
  summary: string;
}

export interface Highlight {
  startSeconds: number;
  endSeconds: number;
  /** Event type chosen by the model for this kind of video, e.g. "Drift" or "Hot Take". */
  label: string;
  title: string;
  summary: string;
  /** How clip-worthy the content itself is. Not a popularity or replay measurement. */
  strength: Strength;
  evidence: { atSeconds: number; source: EvidenceSource; description: string };
}

export interface TopicChapter {
  startSeconds: number;
  endSeconds: number;
  title: string;
  summary: string;
}

export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface TranscriptSection {
  window: number;
  source: "youtube_captions";
  language: string;
  segments: TranscriptSegment[];
  model?: string;
}

export type AnalysisStatus = "queued" | "running" | "complete" | "failed" | "cancelled";

export interface AnalysisProgress {
  phase?: "fetching_transcript" | "analyzing" | "verifying";
  transcriptSections?: TranscriptSection[];
  transcriptNotice?: string;
  modelsUsed?: string[];
  status: AnalysisStatus;
  totalWindows: number;
  completedWindows: number[];
  failedWindows: number[];
  coveredSeconds: number;
  profile: VideoProfile | null;
  windowProfiles: { window: number; seconds: number; profile: VideoProfile }[];
  highlights: Highlight[];
  topics: TopicChapter[];
  /** Model suggestions discarded for invalid or out-of-range timestamps. */
  rejectedSuggestions: number;
  retryRounds: number;
  updatedAt: string;
  message?: string;
}

export interface AnalysisState extends AnalysisProgress {
  id: string;
  durationSeconds: number;
  workerOnline: boolean;
}

const STRENGTH_RANK: Record<Strength, number> = { high: 3, medium: 2, low: 1 };

/** Strongest clip candidates by the model's content assessment, earliest first on ties. */
export function topHighlights(highlights: Highlight[], count = 3): Highlight[] {
  return highlights
    .filter((highlight) => highlight.strength !== "low")
    .sort((a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength] || a.startSeconds - b.startSeconds)
    .slice(0, count);
}

export function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Distinct highlight labels with counts, most frequent first, for filter chips. */
export function highlightLabels(highlights: Highlight[]): { key: string; label: string; count: number }[] {
  const groups = new Map<string, { key: string; label: string; count: number }>();
  for (const highlight of highlights) {
    const key = normalizeLabel(highlight.label);
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { key, label: highlight.label.trim(), count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
