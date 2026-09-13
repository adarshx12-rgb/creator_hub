"use client";

import { useEffect, useRef, useState } from "react";
import { twitchEmbedUrl } from "@/lib/twitch-links";
import type { SearchResult } from "@/lib/types";

export function TwitchPlayer({ video, initialSeconds }: { video: SearchResult; initialSeconds?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const [parent, setParent] = useState("");
  const [wideEnough, setWideEnough] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setParent(window.location.hostname);
      setWideEnough(entry.contentRect.width >= 400);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={container} className="overflow-hidden rounded-lg border border-border bg-black">
      {parent && wideEnough ? (
        <iframe
          src={twitchEmbedUrl(video.id, parent, initialSeconds)}
          className="aspect-video min-h-[300px] w-full"
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture"
          title={video.title}
        />
      ) : (
        <div className="flex min-h-48 items-center justify-center px-5 text-center text-sm text-text-muted">
          {parent ? "Open this video on Twitch to watch on a smaller screen." : "Loading Twitch player…"}
        </div>
      )}
      <a href={video.url} target="_blank" rel="noopener noreferrer" className="block border-t border-border bg-surface px-4 py-3 text-center text-xs text-accent hover:underline">
        Open on Twitch
      </a>
    </div>
  );
}
