"use client";

import Image from "next/image";
import { ExternalLink, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SearchResult } from "@/lib/types";
import type { RefObject } from "react";
import { TwitchPlayer } from "./TwitchPlayer";

interface PlayerPanelProps {
  video: SearchResult;
  containerRef: RefObject<HTMLDivElement | null>;
  initialSeconds?: number;
}

const PLATFORM_LABEL: Record<SearchResult["provider"], string> = { youtube: "YouTube", twitch: "Twitch" };

export function PlayerPanel({ video, containerRef, initialSeconds }: PlayerPanelProps) {
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
    return <TwitchPlayer video={video} initialSeconds={initialSeconds} />;
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
