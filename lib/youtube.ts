import "server-only";
import { parseIso8601Duration } from "./format";
import type { Capabilities, ParsedQuery, PopularVideo, PopularVideos, SearchResponse, SearchResult, SortOrder } from "./types";

const SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";
const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

interface YoutubeApiError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

function buildSearchTerms(parsed: ParsedQuery): string {
  const parts = [parsed.searchTerms, parsed.subject, parsed.topic, ...parsed.visualRequirements].filter(
    (part): part is string => Boolean(part && part.trim()),
  );
  const unique = Array.from(new Set(parts.map((p) => p.trim())));
  return (unique[0] || parsed.searchTerms || "").slice(0, 300);
}

function capabilitiesFor(embeddable: boolean | undefined, privacyStatus: string | undefined): Capabilities {
  if (privacyStatus && privacyStatus !== "public") {
    return {
      canPreview: false,
      canAnalyze: false,
      canExport: false,
      capabilityReason: "This video is not publicly available.",
      evidenceType: "metadata",
    };
  }
  if (embeddable === false) {
    return {
      canPreview: false,
      canAnalyze: false,
      canExport: false,
      capabilityReason: "The publisher has disabled embedded playback for this video.",
      evidenceType: "metadata",
    };
  }
  return {
    canPreview: true,
    canAnalyze: Boolean(process.env.GEMINI_API_KEY && process.env.SUPADATA_API_KEY),
    canExport: false,
    capabilityReason: "Official playback. AI analysis uses Gemini's public YouTube video input when configured; export requires an authorized upload.",
    evidenceType: "metadata",
  };
}

export async function searchYoutube(options: {
  query: string;
  parsed: ParsedQuery;
  order: SortOrder;
  pageToken?: string;
  maxResults?: number;
}): Promise<SearchResponse> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    return {
      status: "setup_required",
      message:
        "YouTube search is not configured yet. Add YOUTUBE_API_KEY to your environment to enable real results.",
      query: options.query,
      results: [],
    };
  }

  const searchTerms = buildSearchTerms(options.parsed) || options.query;
  const searchParams = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: searchTerms,
    maxResults: String(options.maxResults ?? 20),
    order: options.order,
    safeSearch: "moderate",
    key: apiKey,
  });
  if (options.pageToken) searchParams.set("pageToken", options.pageToken);

  let searchRes: Response;
  try {
    searchRes = await fetch(`${SEARCH_URL}?${searchParams.toString()}`, {
      cache: "no-store",
    });
  } catch {
    return {
      status: "error",
      message: "Could not reach YouTube right now. Try again in a moment.",
      query: options.query,
      parsed: options.parsed,
      results: [],
    };
  }

  if (!searchRes.ok) {
    const body = (await searchRes.json().catch(() => null)) as YoutubeApiError | null;
    const reason = body?.error?.errors?.[0]?.reason;
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      return {
        status: "quota_exceeded",
        message: "The YouTube API quota for today has been used up. Search will resume when it resets.",
        query: options.query,
        parsed: options.parsed,
        results: [],
      };
    }
    return {
      status: "error",
      message: body?.error?.message || "YouTube search failed unexpectedly.",
      query: options.query,
      parsed: options.parsed,
      results: [],
    };
  }

  const searchJson = (await searchRes.json()) as {
    items: { id: { videoId?: string } }[];
    nextPageToken?: string;
    prevPageToken?: string;
    pageInfo?: { totalResults?: number };
  };

  const videoIds = searchJson.items.map((item) => item.id.videoId).filter((id): id is string => Boolean(id));

  if (videoIds.length === 0) {
    return {
      status: "ok",
      query: options.query,
      parsed: options.parsed,
      results: [],
      nextPageToken: searchJson.nextPageToken ?? null,
      prevPageToken: searchJson.prevPageToken ?? null,
      totalResults: searchJson.pageInfo?.totalResults ?? 0,
    };
  }

  const videosParams = new URLSearchParams({
    part: "snippet,contentDetails,statistics,status",
    id: videoIds.join(","),
    key: apiKey,
  });

  let videosRes: Response;
  try {
    videosRes = await fetch(`${VIDEOS_URL}?${videosParams.toString()}`, { cache: "no-store" });
  } catch {
    return {
      status: "error",
      message: "Found matching videos but could not load their details. Try again in a moment.",
      query: options.query,
      parsed: options.parsed,
      results: [],
    };
  }

  if (!videosRes.ok) {
    const body = (await videosRes.json().catch(() => null)) as YoutubeApiError | null;
    return {
      status: "error",
      message: body?.error?.message || "Could not load details for the matching videos.",
      query: options.query,
      parsed: options.parsed,
      results: [],
    };
  }

  const videosJson = (await videosRes.json()) as {
    items: {
      id: string;
      snippet: {
        title: string;
        channelTitle: string;
        channelId: string;
        publishedAt: string;
        thumbnails: Record<string, { url: string }>;
      };
      contentDetails: { duration: string };
      statistics?: { viewCount?: string };
      status?: { embeddable?: boolean; privacyStatus?: string };
    }[];
  };

  const now = new Date().toISOString();
  const results: SearchResult[] = videosJson.items.map((item) => ({
    id: item.id,
    provider: "youtube",
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    channelUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`,
    thumbnailUrl:
      item.snippet.thumbnails.high?.url ||
      item.snippet.thumbnails.medium?.url ||
      item.snippet.thumbnails.default?.url ||
      "",
    publishedAt: item.snippet.publishedAt,
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
    statsFetchedAt: now,
    matchType: "metadata",
    capabilities: capabilitiesFor(item.status?.embeddable, item.status?.privacyStatus),
  }));

  return {
    status: "ok",
    query: options.query,
    parsed: options.parsed,
    results,
    nextPageToken: searchJson.nextPageToken ?? null,
    prevPageToken: searchJson.prevPageToken ?? null,
    totalResults: searchJson.pageInfo?.totalResults ?? results.length,
  };
}

export async function getYoutubeVideo(id: string): Promise<SearchResult | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    part: "snippet,contentDetails,statistics,status",
    id,
    key: apiKey,
  });
  const res = await fetch(`${VIDEOS_URL}?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    items: {
      id: string;
      snippet: {
        title: string;
        channelTitle: string;
        channelId: string;
        publishedAt: string;
        thumbnails: Record<string, { url: string }>;
      };
      contentDetails: { duration: string };
      statistics?: { viewCount?: string };
      status?: { embeddable?: boolean; privacyStatus?: string };
    }[];
  };
  const item = json.items[0];
  if (!item) return null;

  return {
    id: item.id,
    provider: "youtube",
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
    channelUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`,
    thumbnailUrl:
      item.snippet.thumbnails.high?.url ||
      item.snippet.thumbnails.medium?.url ||
      item.snippet.thumbnails.default?.url ||
      "",
    publishedAt: item.snippet.publishedAt,
    durationSeconds: parseIso8601Duration(item.contentDetails.duration),
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
    statsFetchedAt: new Date().toISOString(),
    matchType: "metadata",
    capabilities: capabilitiesFor(item.status?.embeddable, item.status?.privacyStatus),
  };
}

/** YouTube's own mostPopular chart, in YouTube's order. Never throws; failures return an honest status. */
export async function getPopularYoutubeVideos(limit = 8): Promise<PopularVideos> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { status: "setup_required", videos: [], fetchedAt: null };

  const params = new URLSearchParams({ part: "snippet", chart: "mostPopular", maxResults: String(limit), key: apiKey });
  try {
    // One quota unit per hour at most; well inside YouTube's 30-day limit for stored API data.
    const res = await fetch(`${VIDEOS_URL}?${params.toString()}`, { next: { revalidate: 3600 } });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as YoutubeApiError | null;
      const reason = body?.error?.errors?.[0]?.reason;
      const quota = reason === "quotaExceeded" || reason === "dailyLimitExceeded";
      return { status: quota ? "quota_exceeded" : "error", videos: [], fetchedAt: null };
    }

    const json = (await res.json()) as {
      items?: { id: string; snippet: { title: string; channelTitle: string; thumbnails: Record<string, { url: string }> } }[];
    };
    const videos = (json.items ?? []).flatMap((item): PopularVideo[] => {
      const { thumbnails } = item.snippet;
      const thumbnailUrl = thumbnails.maxres?.url || thumbnails.standard?.url || thumbnails.high?.url || thumbnails.medium?.url;
      if (!thumbnailUrl?.startsWith("https://i.ytimg.com/")) return [];
      return [{ id: item.id, title: item.snippet.title, channelTitle: item.snippet.channelTitle, thumbnailUrl }];
    });
    // The Date header is cached with the response, so it reflects when YouTube actually served the chart.
    const servedAt = Date.parse(res.headers.get("date") ?? "");
    return { status: "ok", videos, fetchedAt: Number.isNaN(servedAt) ? null : new Date(servedAt).toISOString() };
  } catch {
    return { status: "error", videos: [], fetchedAt: null };
  }
}
