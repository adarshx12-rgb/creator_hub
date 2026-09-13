"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { Eye, ShieldOff } from "lucide-react";
import { formatDuration, formatRelativeDate, formatViews } from "@/lib/format";
import type { Provider, SearchResult } from "@/lib/types";

const PLATFORM_LABEL: Record<Provider, string> = { youtube: "YouTube", twitch: "Twitch" };
const PLATFORM_CLASS: Record<Provider, string> = {
  youtube: "bg-black/75 text-white/90",
  twitch: "bg-[#6441a5]/85 text-white/90",
};

export function ResultCard({ result }: { result: SearchResult }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link
        href={`/video/${result.provider}/${result.id}`}
        className="group block overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-border-strong"
      >
        <div className="relative aspect-video w-full overflow-hidden bg-surface-raised">
          {result.thumbnailUrl ? (
            <Image
              src={result.thumbnailUrl}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-text-faint">
              No thumbnail
            </div>
          )}
          <span
            className={`absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${PLATFORM_CLASS[result.provider]}`}
          >
            {PLATFORM_LABEL[result.provider]}
            {result.provider === "twitch" && (result.mediaType === "video" ? " video" : " clip")}
          </span>
          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[0.7rem] tabular-nums text-white">
            {formatDuration(result.durationSeconds)}
          </span>
          {!result.capabilities.canPreview && (
            <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[0.65rem] text-white/90">
              <ShieldOff size={10} /> No embed
            </span>
          )}
        </div>
        <div className="p-3.5">
          <h3 className="line-clamp-2 text-sm font-medium leading-snug text-text">{result.title}</h3>
          <p className="mt-1.5 truncate text-xs text-text-muted">{result.channelTitle}</p>
          <div className="mt-2.5 flex items-center gap-3 text-[0.7rem] text-text-faint">
            <span className="flex items-center gap-1">
              <Eye size={11} /> {formatViews(result.viewCount)}
            </span>
            <span>·</span>
            <span>{formatRelativeDate(result.publishedAt)}</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
