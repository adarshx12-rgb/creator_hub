import "server-only";
import { parseTwitchDuration, parseTwitchLink } from "./twitch-links";
import type { ParsedQuery, SearchResponse, SearchResult, SortOrder } from "./types";

const HELIX_URL = "https://api.twitch.tv/helix";
let cachedToken: { value: string; expiresAt: number; clientId: string } | null = null;

class TwitchError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function getToken(clientId: string, clientSecret: string): Promise<string> {
  if (cachedToken?.clientId === clientId && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new TwitchError(response.status, "Could not authenticate with Twitch. Check the server's Twitch credentials.");
  const json = await response.json() as { access_token: string; expires_in: number };
  if (!json.access_token || !Number.isFinite(json.expires_in)) throw new Error("Invalid Twitch token response");
  cachedToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000, clientId };
  return json.access_token;
}

async function helix<T>(endpoint: string, params: Record<string, string>, retry = true): Promise<T[]> {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!clientId || !secret) throw new TwitchError(0, "Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to enable Twitch discovery.");
  const token = await getToken(clientId, secret);
  const response = await fetch(`${HELIX_URL}/${endpoint}?${new URLSearchParams(params)}`, {
    headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401 && retry) {
    cachedToken = null;
    return helix(endpoint, params, false);
  }
  if (response.status === 404 && (endpoint === "videos" || endpoint === "clips")) return [];
  if (!response.ok) throw new TwitchError(response.status,
    response.status === 429 ? "Twitch's rate limit was reached. Try again shortly." : "Twitch could not load this content. Try again shortly.");
  const json = await response.json() as { data: T[] };
  if (!Array.isArray(json.data)) throw new Error("Invalid Twitch response");
  return json.data;
}

interface TwitchChannel { id: string; broadcaster_login: string; display_name: string }
interface TwitchClip {
  id: string; broadcaster_id: string; broadcaster_name: string; title: string;
  view_count: number; created_at: string; thumbnail_url: string; duration: number;
}
interface TwitchVideo {
  id: string; user_login: string; user_name: string; title: string; view_count: number;
  published_at: string; thumbnail_url: string; duration: string; viewable: string;
}

function clipResult(clip: TwitchClip, login: string): SearchResult {
  return {
    id: clip.id, provider: "twitch", mediaType: "clip", url: `https://clips.twitch.tv/${clip.id}`,
    title: clip.title, channelTitle: clip.broadcaster_name, channelUrl: `https://www.twitch.tv/${login}`,
    thumbnailUrl: clip.thumbnail_url, publishedAt: clip.created_at, durationSeconds: Math.round(clip.duration),
    viewCount: clip.view_count, statsFetchedAt: new Date().toISOString(), matchType: "metadata",
    capabilities: { canPreview: true, canAnalyze: false, canExport: false, evidenceType: "metadata",
      capabilityReason: "Official Twitch clip. Preview and save its source; export requires an authorized upload." },
  };
}

function videoResult(video: TwitchVideo): SearchResult {
  return {
    // Prefix VOD IDs so existing clip routes and saved clip IDs keep working.
    id: `vod-${video.id}`, provider: "twitch", mediaType: "video", url: `https://www.twitch.tv/videos/${video.id}`,
    title: video.title, channelTitle: video.user_name, channelUrl: `https://www.twitch.tv/${video.user_login}`,
    thumbnailUrl: video.thumbnail_url.replace(/%?\{width\}/g, "640").replace(/%?\{height\}/g, "360"),
    publishedAt: video.published_at, durationSeconds: parseTwitchDuration(video.duration),
    viewCount: video.view_count, statsFetchedAt: new Date().toISOString(), matchType: "metadata",
    capabilities: { canPreview: video.viewable === "public", canAnalyze: false, canExport: false, evidenceType: "metadata",
      capabilityReason: video.viewable === "public"
        ? "Twitch video. Preview and save its source; export requires an authorized upload."
        : "This Twitch video is not publicly playable. Open it on Twitch to check access." },
  };
}

export async function getTwitchClip(id: string): Promise<SearchResult | null> {
  const [clip] = await helix<TwitchClip>("clips", { id });
  if (!clip) return null;
  const [user] = await helix<{ login: string }>("users", { id: clip.broadcaster_id });
  return clipResult(clip, user?.login ?? "");
}

export async function getTwitchVideo(id: string): Promise<SearchResult | null> {
  if (!/^\d+$/.test(id)) return null;
  const [video] = await helix<TwitchVideo>("videos", { id });
  return video ? videoResult(video) : null;
}

function failure(query: string, error: unknown): SearchResponse {
  return {
    query, results: [],
    status: error instanceof TwitchError ? error.status === 0 ? "setup_required" : error.status === 429 ? "quota_exceeded" : "error" : "error",
    message: error instanceof TwitchError ? error.message : "Could not reach Twitch right now. Try again shortly.",
  };
}

export async function searchTwitch(options: { query: string; parsed: ParsedQuery; order: SortOrder; maxResults?: number }): Promise<SearchResponse> {
  const { query, parsed, order } = options;
  try {
    const link = parseTwitchLink(query);
    if (link && link.kind !== "channel") {
      const result = link.kind === "video" ? await getTwitchVideo(link.id) : await getTwitchClip(link.id);
      return { status: "ok", query, results: result ? [result] : [], totalResults: result ? 1 : 0 };
    }
    const channelQuery = (link?.id ?? parsed.subject ?? query).trim().replace(/^@/, "").slice(0, 100);
    const candidates = await helix<TwitchChannel>("search/channels", { query: channelQuery, first: "5" });
    const exact = candidates.find((channel) => channel.broadcaster_login.toLowerCase() === channelQuery.toLowerCase());
    const channels = exact ? [exact] : candidates.slice(0, 3);
    if (!channels.length) return { status: "ok", query, results: [], totalResults: 0 };
    const limit = Math.max(1, Math.min(100, options.maxResults ?? 20));
    const first = String(Math.ceil(limit / channels.length / 2));
    const batches = await Promise.allSettled(channels.flatMap((channel) => [
      helix<TwitchVideo>("videos", { user_id: channel.id, first, sort: order === "viewCount" ? "views" : "time" })
        .then((videos) => videos.map(videoResult)),
      helix<TwitchClip>("clips", { broadcaster_id: channel.id, first })
        .then((clips) => clips.map((clip) => clipResult(clip, channel.broadcaster_login))),
    ]));
    const failed = batches.filter((batch) => batch.status === "rejected");
    if (failed.length === batches.length) return failure(query, failed[0].reason);
    let results = batches.flatMap((batch) => batch.status === "fulfilled" ? batch.value : []);
    if (order === "date") results.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
    if (order === "viewCount") results.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
    results = results.slice(0, limit);
    return { status: "ok", query, results, totalResults: results.length,
      providerNotices: failed.length ? [{ provider: "twitch", status: "error", message: "Some Twitch videos or clips could not be loaded." }] : undefined };
  } catch (error) { return failure(query, error); }
}
