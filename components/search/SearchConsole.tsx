"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Clock, Sparkles } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { RevealGroup, RevealItem } from "@/components/motion/Reveal";
import { ClipWorkflow } from "@/components/motion/ClipWorkflow";
import { PopularDeck } from "@/components/motion/PopularDeck";
import { Chip } from "@/components/ui/Chip";
import { EXAMPLE_QUERIES, PRODUCT_NAME } from "@/lib/constants";
import { addRecentSearch, clearRecentSearches, getRecentSearches } from "@/lib/local-store";
import { formatRelativeDate } from "@/lib/format";
import type { PopularVideos, RecentSearch } from "@/lib/types";

export function SearchConsole({ popular }: { popular: PopularVideos }) {
  const router = useRouter();
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  useEffect(() => {
    // One-time hydration from localStorage, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(getRecentSearches());
  }, []);

  function runSearch(query: string) {
    addRecentSearch(query);
    router.push(`/results?q=${encodeURIComponent(query)}`);
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-5 py-12 sm:px-6 md:min-h-dvh lg:py-14">
      <RevealGroup className="flex w-full min-w-0 max-w-5xl flex-col">
        {/* Search stays first on small screens; the showcase leads on wide layouts. */}
        <RevealItem className="order-2 mt-14 grid gap-8 lg:order-none lg:mb-14 lg:mt-0 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-6">
          <PopularDeck popular={popular} onSearch={runSearch} />
          <div className="flex lg:pt-[3.25rem]">
            <ClipWorkflow />
          </div>
        </RevealItem>

        <div className="order-1 mx-auto w-full max-w-2xl lg:order-none">
          <RevealItem className="mb-3 text-center">
            <h1 className="font-display text-3xl font-medium tracking-tight text-text sm:text-4xl">
              Find the moment, not just the video
            </h1>
          </RevealItem>
          <RevealItem className="mb-8 text-center">
            <p className="mx-auto max-w-md text-[0.95rem] leading-relaxed text-text-muted">
              Describe a person, subject, or topic. {PRODUCT_NAME} surfaces real public sources you can
              preview, save, and — where you hold the rights — trim into a clip.
            </p>
          </RevealItem>
          <RevealItem>
            <SearchBar onSubmit={runSearch} />
            <p className="mt-3 text-center text-xs text-text-muted">Search a Twitch channel name, or paste a Twitch video or clip link.</p>
          </RevealItem>
          <RevealItem className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLE_QUERIES.map((example) => (
              <Chip key={example} icon={<Sparkles size={11} />} onClick={() => runSearch(example)}>
                {example}
              </Chip>
            ))}
          </RevealItem>

          {recent.length > 0 && (
            <RevealItem className="mt-10">
              <div className="mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-text-faint">
                  <Clock size={13} /> Recent searches
                </span>
                <button
                  type="button"
                  onClick={() => setRecent(clearRecentSearches())}
                  className="text-xs text-text-faint hover:text-text-muted"
                >
                  Clear
                </button>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {recent.map((entry) => (
                  <li key={entry.query}>
                    <button
                      type="button"
                      onClick={() => runSearch(entry.query)}
                      className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left text-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                    >
                      <span className="truncate">{entry.query}</span>
                      <span className="shrink-0 text-xs text-text-faint">{formatRelativeDate(entry.at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </RevealItem>
          )}
        </div>
      </RevealGroup>
    </div>
  );
}
