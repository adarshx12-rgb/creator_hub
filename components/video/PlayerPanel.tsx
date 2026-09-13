"use client";

import Image from "next/image";
import { ExternalLink, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SearchResult } from "@/lib/types";
import type { RefObject } from "react";

interface PlayerPanelProps {
  video: SearchResult;
  containerRef: RefObject<HTMLDivElement | null>;
}

const PLATFORM_LABEL: Record<SearchResult["provider"], string> = { youtube: "YouTube", twitch: "Twitch" };

export function PlayerPanel({ video, containerRef }: PlayerPanelProps) {
  if (!video.capabilities.canPreview) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface">
        {video.thumbnailUrl && (
          <Image src={video.thumbnailUrl} alt="" fill className="object-cover opacity-40" />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg/60 px-6 text-center">
          <ShieldOff size={22} className="text-text-faint" />
          <p className="max-w-sm text-sm text-text-muted">{video.capabilities.capabilityReason}</p>
          <Button variant="primary" size="sm" icon={<ExternalLink size={14} />} onClick={() => window.open(video.url, "_blank", "noopener,noreferrer")}>
            Open on {PLATFORM_LABEL[video.provider]}
          </Button>
        </div>
      </div>
    );
  }

  if (video.provider === "twitch") {
    const parent = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return (
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
        <iframe
          src={`https://clips.twitch.tv/embed?clip=${encodeURIComponent(video.id)}&parent=${parent}&autoplay=false`}
          className="h-full w-full"
          allowFullScreen
          title={video.title}
        />
      </div>
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
