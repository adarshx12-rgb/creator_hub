import { NextRequest, NextResponse } from "next/server";
import { parseSearchQuery } from "@/lib/query-parser";
import { searchYoutube } from "@/lib/youtube";
import { searchTwitch } from "@/lib/twitch";
import { parseTwitchLink } from "@/lib/twitch-links";
import type { ProviderNotice, SearchResponse, SearchResult, SearchStatus, SortOrder } from "@/lib/types";

const VALID_ORDERS: SortOrder[] = ["relevance", "date", "viewCount", "rating"];

function overallStatus(notices: ProviderNotice[]): SearchStatus {
  if (notices.some((n) => n.status === "ok")) return "ok";
  if (notices.every((n) => n.status === "setup_required")) return "setup_required";
  if (notices.some((n) => n.status === "quota_exceeded")) return "quota_exceeded";
  return "error";
}

function sortMerged(results: SearchResult[], order: SortOrder): SearchResult[] {
  if (order === "date") {
    return results
      .slice()
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
  if (order === "viewCount") {
    return results.slice().sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  }
  // "relevance" and "rating" keep each provider's own ranking; provider order (YouTube, then Twitch) is preserved.
  return results;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const orderParam = searchParams.get("order") ?? "relevance";
  const pageToken = searchParams.get("pageToken") ?? undefined;

  if (!query) {
    return NextResponse.json(
      { status: "error", message: "A search query is required.", query: "", results: [] },
      { status: 400 },
    );
  }

  const order: SortOrder = VALID_ORDERS.includes(orderParam as SortOrder) ? (orderParam as SortOrder) : "relevance";
  const twitchLink = parseTwitchLink(query);
  const parsed = twitchLink ? {
    subject: twitchLink.kind === "channel" ? twitchLink.id : null,
    topic: null, visualRequirements: [], targetSegmentSeconds: null,
    searchTerms: query, source: "heuristic" as const,
  } : await parseSearchQuery(query);

  // Resolve pasted Twitch sources without spending YouTube search quota.
  if (twitchLink) return NextResponse.json(await searchTwitch({ query, parsed, order }));

  const [youtubeResponse, twitchResponse] = await Promise.all([
    searchYoutube({ query, parsed, order, pageToken }),
    // This UI pages YouTube only; Twitch's bounded batch appears on the first page.
    // Helix cursors are not interchangeable with YouTube tokens.
    pageToken
      ? Promise.resolve<SearchResponse>({ status: "ok", query, results: [] })
      : searchTwitch({ query, parsed, order }),
  ]);

  const notices: ProviderNotice[] = [
    { provider: "youtube", status: youtubeResponse.status, message: youtubeResponse.message },
    ...(pageToken ? [] : [{ provider: "twitch" as const, status: twitchResponse.status, message: twitchResponse.message }]),
  ];

  const merged = sortMerged([...youtubeResponse.results, ...twitchResponse.results], order);

  const response: SearchResponse = {
    status: overallStatus(notices),
    query,
    parsed,
    results: merged,
    nextPageToken: youtubeResponse.nextPageToken ?? null,
    prevPageToken: youtubeResponse.prevPageToken ?? null,
    totalResults: youtubeResponse.totalResults == null ? merged.length : youtubeResponse.totalResults + twitchResponse.results.length,
    providerNotices: [...notices.filter((n) => n.status !== "ok"), ...(twitchResponse.providerNotices ?? [])],
    message: merged.length === 0 ? youtubeResponse.message ?? twitchResponse.message : undefined,
  };

  return NextResponse.json(response);
}
