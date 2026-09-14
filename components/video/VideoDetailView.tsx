"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PlayerPanel } from "./PlayerPanel";
import { SourcePanel } from "./SourcePanel";
import { MomentsPanel } from "./MomentsPanel";
import { HighlightsPanel } from "./HighlightsPanel";
import { useYoutubePlayer } from "./useYoutubePlayer";
import type { SearchResult } from "@/lib/types";

export function VideoDetailView({ video, initialSeconds }: { video: SearchResult; initialSeconds?: number }) {
  const [savedRevision, setSavedRevision] = useState(0);
  const { containerRef, ready, getCurrentTime, seekTo, currentTime, previewRange } = useYoutubePlayer(
    video.id,
    video.provider === "youtube" && video.capabilities.canPreview,
    initialSeconds,
  );
  // Twitch clip playback uses a plain iframe embed (no JS control API wired up yet),
  // so time-capture for "save current timestamp" is YouTube-only for now.
  const canCaptureTime = video.provider === "youtube" && video.capabilities.canPreview && ready;

  return (
    <div className="mx-auto max-w-[1680px] px-5 py-8 md:px-8">
      <Link
        href="/results"
        className="mb-5 inline-flex items-center gap-1.5 text-xs text-text-faint hover:text-text-muted"
      >
        <ArrowLeft size={13} /> Back to results
      </Link>
      <div className="grid gap-6 lg:grid-cols-[1fr_440px]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <PlayerPanel video={video} containerRef={containerRef} initialSeconds={initialSeconds} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <HighlightsPanel key={`${video.provider}:${video.id}`} video={video} seekTo={seekTo} currentTime={currentTime} previewRange={previewRange} playerReady={ready} onSaved={() => setSavedRevision((value) => value + 1)} />
          <SourcePanel video={video} />
          <MomentsPanel
            key={savedRevision}
            video={video}
            canCaptureTime={canCaptureTime}
            getCurrentTime={getCurrentTime}
            seekTo={seekTo}
          />
        </div>
      </div>
    </div>
  );
}
