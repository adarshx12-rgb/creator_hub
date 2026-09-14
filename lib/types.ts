export type EvidenceType = "metadata" | "transcript" | "video";

export type Provider = "youtube" | "twitch";

export interface Capabilities {
  canPreview: boolean;
  canAnalyze: boolean;
  canExport: boolean;
  capabilityReason: string;
  evidenceType: EvidenceType;
}

export interface SearchResult {
  id: string;
  mediaType?: "video" | "clip";
  provider: Provider;
  url: string;
  title: string;
  channelTitle: string;
  channelUrl: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
  statsFetchedAt: string | null;
  matchType: "metadata";
  capabilities: Capabilities;
}

export type SearchStatus = "ok" | "setup_required" | "error" | "quota_exceeded";

export interface ProviderNotice {
  provider: Provider;
  status: SearchStatus;
  message?: string;
}

export interface ParsedQuery {
  subject: string | null;
  topic: string | null;
  visualRequirements: string[];
  targetSegmentSeconds: { min: number; max: number } | null;
  searchTerms: string;
  source: "llm" | "heuristic";
}

export type SortOrder = "relevance" | "date" | "viewCount" | "rating";

export interface SearchResponse {
  status: SearchStatus;
  message?: string;
  query: string;
  parsed?: ParsedQuery;
  results: SearchResult[];
  nextPageToken?: string | null;
  prevPageToken?: string | null;
  totalResults?: number | null;
  providerNotices?: ProviderNotice[];
}

export interface PopularVideo {
  id: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
}

export interface PopularVideos {
  status: SearchStatus;
  videos: PopularVideo[];
  fetchedAt: string | null;
}

export interface SavedMoment {
  id: string;
  provider: Provider;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channelTitle: string;
  thumbnailUrl: string;
  startSeconds: number | null;
  endSeconds: number | null;
  note: string;
  createdAt: string;
  linkType: "timestamp" | "official_clip";
  savedLink: string;
}

export interface RecentSearch {
  query: string;
  at: string;
}

export interface UploadedAsset {
  id: string;
  fileName: string;
  objectUrl: string;
  durationSeconds: number | null;
  addedAt: string;
}

export type CropMode = "original" | "9:16" | "1:1";

export interface TrimSelection {
  assetId: string;
  startSeconds: number;
  endSeconds: number;
  crop: CropMode;
}

export type JobStatus = "queued" | "blocked" | "failed";

export interface ExportJob {
  id: string;
  assetId: string;
  assetName: string;
  selection: TrimSelection;
  status: JobStatus;
  statusMessage: string;
  createdAt: string;
}
