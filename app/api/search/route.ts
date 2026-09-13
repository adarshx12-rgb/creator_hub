import { NextRequest, NextResponse } from "next/server";
import { parseSearchQuery } from "@/lib/query-parser";
import { searchYoutube } from "@/lib/youtube";
import { searchTwitch } from "@/lib/twitch";
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
  const parsed = await parseSearchQuery(query);

  const [youtubeResponse, twitchResponse] = await Promise.all([
    searchYoutube({ query, parsed, order, pageToken }),
    // Twitch has no page-token pagination of its own; only fold its (single page of)
    // clips in on the first page so they don't repeat on every subsequent YouTube page.
    pageToken
      ? Promise.resolve<SearchResponse>({ status: "ok", query, results: [] })
      : searchTwitch({ query, parsed, order }),
  ]);

  const notices: ProviderNotice[] = [
    { provider: "youtube", status: youtubeResponse.status, message: youtubeResponse.message },
    { provider: "twitch", status: twitchResponse.status, message: twitchResponse.message },
  ];

  const merged = sortMerged([...youtubeResponse.results, ...twitchResponse.results], order);

  const response: SearchResponse = {
    status: overallStatus(notices),
    query,
    parsed,
    results: merged,
    nextPageToken: youtubeResponse.nextPageToken ?? null,
    prevPageToken: youtubeResponse.prevPageToken ?? null,
    totalResults: youtubeResponse.totalResults ?? merged.length,
    providerNotices: notices.filter((n) => n.status !== "ok"),
    message: merged.length === 0 ? youtubeResponse.message ?? twitchResponse.message : undefined,
  };

  return NextResponse.json(response);
}
