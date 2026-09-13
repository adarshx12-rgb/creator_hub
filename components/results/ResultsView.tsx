"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { SearchBar } from "@/components/search/SearchBar";
import { FilterBar, type DurationFilter } from "./FilterBar";
import { ResultCard } from "./ResultCard";
import { ResultsSkeleton } from "./ResultsSkeleton";
import { Pagination } from "./Pagination";
import { EmptyResultsPanel, ErrorPanel, QuotaExceededPanel, SetupRequiredPanel } from "./StatusPanel";
import { addRecentSearch } from "@/lib/local-store";
import type { Provider, SearchResponse, SortOrder } from "@/lib/types";

const ALL_SOURCES: Provider[] = ["youtube", "twitch"];

const PROVIDER_LABEL: Record<Provider, string> = { youtube: "YouTube", twitch: "Twitch" };

function withinDuration(seconds: number | null, filter: DurationFilter): boolean {
  if (filter === "any" || seconds === null) return true;
  if (filter === "short") return seconds < 240;
  if (filter === "medium") return seconds >= 240 && seconds <= 1200;
  return seconds > 1200;
}

export function ResultsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";

  const [order, setOrder] = useState<SortOrder>("relevance");
  const [duration, setDuration] = useState<DurationFilter>("any");
  const [sources, setSources] = useState<Provider[]>(ALL_SOURCES);
  const [tokens, setTokens] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchPage = useCallback(async (q: string, sortOrder: SortOrder, pageToken?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q, order: sortOrder });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await fetch(`/api/search?${params.toString()}`);
      const json = (await res.json()) as SearchResponse;
      setData(json);
    } catch {
      setData({ status: "error", query: q, results: [], message: "Could not reach the search service." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!query) return;
    addRecentSearch(query);
    // Resetting pagination when the query/order changes (not on every render) is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTokens([undefined]);
    setPageIndex(0);
    void fetchPage(query, order);
    // Re-run only when the query or sort order actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, order]);

  function goNext() {
    if (!data?.nextPageToken) return;
    const nextIndex = pageIndex + 1;
    const token = data.nextPageToken;
    setTokens((prev) => {
      const next = [...prev];
      next[nextIndex] = token;
      return next;
    });
    setPageIndex(nextIndex);
    void fetchPage(query, order, token);
  }

  function goPrev() {
    if (pageIndex === 0) return;
    const prevIndex = pageIndex - 1;
    setPageIndex(prevIndex);
    void fetchPage(query, order, tokens[prevIndex]);
  }

  const filteredResults = useMemo(
    () =>
      (data?.results ?? []).filter(
        (r) => withinDuration(r.durationSeconds, duration) && sources.includes(r.provider),
      ),
    [data, duration, sources],
  );

  if (!query) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <EmptyResultsPanel query="" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <SearchBar
          key={query}
          size="md"
          defaultValue={query}
          onSubmit={(next) => router.push(`/results?q=${encodeURIComponent(next)}`)}
        />
      </div>

      {data?.status === "ok" && data.results.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <FilterBar
            order={order}
            onOrderChange={setOrder}
            duration={duration}
            onDurationChange={setDuration}
            sources={sources}
            onSourcesChange={setSources}
          />
          {typeof data.totalResults === "number" && (
            <span className="text-xs text-text-faint">{data.totalResults.toLocaleString()} results</span>
          )}
        </div>
      )}

      {!loading && data?.providerNotices && data.providerNotices.length > 0 && (
        <p className="mb-4 text-xs text-text-faint">
          {data.providerNotices
            .map((n) =>
              n.status === "setup_required"
                ? `${PROVIDER_LABEL[n.provider]} isn't configured yet`
                : n.status === "quota_exceeded"
                  ? `${PROVIDER_LABEL[n.provider]} quota reached`
                  : `${PROVIDER_LABEL[n.provider]} search failed`,
            )
            .join(" · ")}
        </p>
      )}

      {loading && <ResultsSkeleton />}

      {!loading && data?.status === "setup_required" && <SetupRequiredPanel message={data.message} />}
      {!loading && data?.status === "quota_exceeded" && <QuotaExceededPanel message={data.message} />}
      {!loading && data?.status === "error" && (
        <ErrorPanel message={data.message} onRetry={() => fetchPage(query, order, tokens[pageIndex])} />
      )}
      {!loading && data?.status === "ok" && filteredResults.length === 0 && <EmptyResultsPanel query={query} />}

      {!loading && data?.status === "ok" && filteredResults.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {filteredResults.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))}
            </AnimatePresence>
          </div>
          <Pagination
            page={pageIndex + 1}
            hasPrev={pageIndex > 0}
            hasNext={Boolean(data.nextPageToken)}
            onPrev={goPrev}
            onNext={goNext}
          />
        </>
      )}
    </div>
  );
}
