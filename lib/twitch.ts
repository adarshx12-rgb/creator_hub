import "server-only";
import type { ParsedQuery, SearchResponse, SearchResult, SortOrder } from "./types";

const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const HELIX_URL = "https://api.twitch.tv/helix";

// Twitch has no full-text "search clips/VODs by topic" endpoint - Search Channels
// only matches channel names/descriptions. So topic queries (e.g. "explaining discipline")
// can only resolve to a channel, then we list that channel's existing official Clips.
// This is a real capability gap versus YouTube, not an oversight.

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

async function getAppAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  let res: Response;
  try {
    res = await fetch(TOKEN_URL, { method: "POST", body: params, cache: "no-store" });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cachedToken.accessToken;
}

function channelQueryFrom(query: string, parsed: ParsedQuery): string {
  const candidate = parsed.subject || query;
  return candidate.trim().slice(0, 100);
}

function capabilitiesForClip(): SearchResult["capabilities"] {
  return {
    canPreview: true,
    canAnalyze: false,
    canExport: false,
    capabilityReason:
      "Official Twitch Clip, already created by the channel or its community. Playback via Twitch's embed; export requires an authorized upload of this footage.",
    evidenceType: "metadata",
  };
}

interface TwitchChannel {
  id: string;
  broadcaster_login: string;
  display_name: string;
}

interface TwitchClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_name: string;
  broadcaster_login?: string;
  title: string;
  view_count: number;
  created_at: string;
  thumbnail_url: string;
  duration: number;
}

export async function searchTwitch(options: {
  query: string;
  parsed: ParsedQuery;
  order: SortOrder;
  maxResults?: number;
}): Promise<SearchResponse> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      status: "setup_required",
      message:
        "Twitch discovery is not configured yet. Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to your environment to enable it.",
      query: options.query,
      results: [],
    };
  }

  const token = await getAppAccessToken(clientId, clientSecret);
  if (!token) {
    return {
      status: "error",
      message: "Could not authenticate with Twitch right now. Try again in a moment.",
      query: options.query,
      results: [],
    };
  }

  const headers = { "Client-Id": clientId, Authorization: `Bearer ${token}` };
  const channelQuery = channelQueryFrom(options.query, options.parsed);
  if (!channelQuery) {
    return { status: "ok", query: options.query, results: [] };
  }

  let channelsRes: Response;
  try {
    channelsRes = await fetch(
      `${HELIX_URL}/search/channels?${new URLSearchParams({ query: channelQuery, first: "5" })}`,
      { headers, cache: "no-store" },
    );
  } catch {
    return {
      status: "error",
      message: "Could not reach Twitch right now. Try again in a moment.",
      query: options.query,
      results: [],
    };
  }

  if (!channelsRes.ok) {
    return {
      status: channelsRes.status === 429 ? "quota_exceeded" : "error",
      message:
        channelsRes.status === 429
          ? "The Twitch API rate limit was hit. Search will resume shortly."
          : "Twitch channel search failed unexpectedly.",
      query: options.query,
      results: [],
    };
  }

  const channelsJson = (await channelsRes.json()) as { data: TwitchChannel[] };
  const channels = channelsJson.data.slice(0, 3);
  if (channels.length === 0) {
    return { status: "ok", query: options.query, results: [] };
  }

  const maxResults = options.maxResults ?? 20;
  const perChannel = Math.max(3, Math.ceil(maxResults / channels.length));

  const clipLists = await Promise.all(
    channels.map(async (channel) => {
      try {
        const res = await fetch(
          `${HELIX_URL}/clips?${new URLSearchParams({ broadcaster_id: channel.id, first: String(perChannel) })}`,
          { headers, cache: "no-store" },
        );
        if (!res.ok) return [] as TwitchClip[];
        const json = (await res.json()) as { data: TwitchClip[] };
        return json.data;
      } catch {
        return [] as TwitchClip[];
      }
    }),
  );

  let clips = clipLists.flat();
  if (options.order === "date") {
    clips = clips.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (options.order === "viewCount") {
    clips = clips.slice().sort((a, b) => b.view_count - a.view_count);
  }
  clips = clips.slice(0, maxResults);

  const now = new Date().toISOString();
  const results: SearchResult[] = clips.map((clip) => ({
    id: clip.id,
    provider: "twitch",
    url: clip.url,
    title: clip.title,
    channelTitle: clip.broadcaster_name,
    channelUrl: `https://twitch.tv/${clip.broadcaster_login ?? clip.broadcaster_name}`,
    thumbnailUrl: clip.thumbnail_url,
    publishedAt: clip.created_at,
    durationSeconds: Math.round(clip.duration),
    viewCount: clip.view_count,
    statsFetchedAt: now,
    matchType: "metadata",
    capabilities: capabilitiesForClip(),
  }));

  return { status: "ok", query: options.query, results, totalResults: results.length };
}

export async function getTwitchClip(id: string): Promise<SearchResult | null> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const token = await getAppAccessToken(clientId, clientSecret);
  if (!token) return null;

  const res = await fetch(`${HELIX_URL}/clips?${new URLSearchParams({ id })}`, {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { data: TwitchClip[] };
  const clip = json.data[0];
  if (!clip) return null;

  return {
    id: clip.id,
    provider: "twitch",
    url: clip.url,
    title: clip.title,
    channelTitle: clip.broadcaster_name,
    channelUrl: `https://twitch.tv/${clip.broadcaster_login ?? clip.broadcaster_name}`,
    thumbnailUrl: clip.thumbnail_url,
    publishedAt: clip.created_at,
    durationSeconds: Math.round(clip.duration),
    viewCount: clip.view_count,
    statsFetchedAt: new Date().toISOString(),
    matchType: "metadata",
    capabilities: capabilitiesForClip(),
  };
}
