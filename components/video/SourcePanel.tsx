"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatRelativeDate, formatViews } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

const PLATFORM_LABEL: Record<SearchResult["provider"], string> = { youtube: "YouTube", twitch: "Twitch" };

export function SourcePanel({ video }: { video: SearchResult }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(video.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable - user can copy the URL from the address bar instead.
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-medium text-text">{video.title}</h3>
      <a
        href={video.channelUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1.5 inline-block text-sm text-text-muted hover:text-accent-strong"
      >
        {video.channelTitle}
      </a>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-faint">
        <span className="flex items-center gap-1">
          <Eye size={12} /> {formatViews(video.viewCount)}
        </span>
        <span>·</span>
        <span>Published {formatRelativeDate(video.publishedAt)}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          icon={<ExternalLink size={14} />}
          onClick={() => window.open(video.url, "_blank", "noopener,noreferrer")}
        >
          Open on {PLATFORM_LABEL[video.provider]}
        </Button>
        <Button variant="secondary" size="sm" icon={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copyLink}>
          {copied ? "Copied" : "Copy source link"}
        </Button>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-text-faint">
        {video.capabilities.capabilityReason}
      </p>
    </div>
  );
}
