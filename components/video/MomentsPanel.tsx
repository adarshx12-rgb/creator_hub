"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Bookmark, ExternalLink, Link2, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatTimecode } from "@/lib/format";
import { addSavedMoment, getSavedMoments, removeSavedMoment, updateSavedMoment } from "@/lib/local-store";
import type { SavedMoment, SearchResult } from "@/lib/types";

interface MomentsPanelProps {
  video: SearchResult;
  canCaptureTime: boolean;
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
}

function makeId(): string {
  return `moment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function MomentsPanel({ video, canCaptureTime, getCurrentTime, seekTo }: MomentsPanelProps) {
  const [moments, setMoments] = useState<SavedMoment[]>([]);
  const [clipUrl, setClipUrl] = useState("");
  const [clipError, setClipError] = useState<string | null>(null);

  useEffect(() => {
    // One-time hydration from localStorage, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoments(getSavedMoments().filter((m) => m.videoId === video.id && m.provider === video.provider));
  }, [video.id, video.provider]);

  function refresh(all: SavedMoment[]) {
    setMoments(all.filter((m) => m.videoId === video.id && m.provider === video.provider));
  }

  function saveTimestamp() {
    const startSeconds = canCaptureTime ? Math.floor(getCurrentTime()) : null;
    const savedLink = startSeconds !== null ? `${video.url}&t=${startSeconds}s` : video.url;
    refresh(
      addSavedMoment({
        id: makeId(),
        provider: video.provider,
        videoId: video.id,
        videoTitle: video.title,
        videoUrl: video.url,
        channelTitle: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
        startSeconds,
        endSeconds: null,
        note: "",
        createdAt: new Date().toISOString(),
        // A Twitch search result is already an official Clip someone created, so bookmarking
        // it as-is is the same thing as pasting a Clip link on YouTube.
        linkType: video.provider === "twitch" && startSeconds === null ? "official_clip" : "timestamp",
        savedLink,
      }),
    );
  }

  function saveClipLink() {
    const trimmed = clipUrl.trim();
    if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(trimmed) && !/^https:\/\/clips\.twitch\.tv\//i.test(trimmed)) {
      setClipError("Paste a youtube.com, youtu.be, or clips.twitch.tv link.");
      return;
    }
    refresh(
      addSavedMoment({
        id: makeId(),
        provider: video.provider,
        videoId: video.id,
        videoTitle: video.title,
        videoUrl: video.url,
        channelTitle: video.channelTitle,
        thumbnailUrl: video.thumbnailUrl,
        startSeconds: null,
        endSeconds: null,
        note: "",
        createdAt: new Date().toISOString(),
        linkType: "official_clip",
        savedLink: trimmed,
      }),
    );
    setClipUrl("");
    setClipError(null);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text">Saved moments</h3>
        <Button variant="primary" size="sm" icon={<Bookmark size={14} />} onClick={saveTimestamp}>
          {canCaptureTime ? "Save current timestamp" : "Save this source"}
        </Button>
      </div>

      {moments.length === 0 ? (
        <p className="mt-3 text-xs leading-relaxed text-text-faint">
          No moments saved yet. Save a timestamp while watching, or paste a link from YouTube&apos;s own
          Clip feature below.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {moments.map((moment) => (
            <motion.li
              key={moment.id}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-md border border-border bg-surface-raised p-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {moment.linkType === "official_clip" ? (
                    <span className="flex items-center gap-1 rounded bg-verified/15 px-1.5 py-0.5 font-mono text-[0.7rem] text-verified">
                      <Link2 size={10} /> Official Clip
                    </span>
                  ) : moment.startSeconds !== null ? (
                    <button
                      type="button"
                      disabled={!canCaptureTime}
                      onClick={() => seekTo(moment.startSeconds ?? 0)}
                      className="flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[0.7rem] text-accent-strong disabled:cursor-default"
                    >
                      <Play size={10} /> {formatTimecode(moment.startSeconds)}
                    </button>
                  ) : (
                    <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[0.7rem] text-text-faint">
                      Source bookmark
                    </span>
                  )}
                  <a
                    href={moment.savedLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text-faint hover:text-text-muted"
                    aria-label="Open saved link"
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
                <button
                  type="button"
                  onClick={() => refresh(removeSavedMoment(moment.id))}
                  className="text-text-faint hover:text-danger"
                  aria-label="Remove saved moment"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <input
                value={moment.note}
                onChange={(e) =>
                  setMoments((prev) => prev.map((m) => (m.id === moment.id ? { ...m, note: e.target.value } : m)))
                }
                onBlur={(e) => updateSavedMoment(moment.id, { note: e.target.value })}
                placeholder="Add a note..."
                className="mt-2 w-full rounded bg-transparent text-xs text-text placeholder:text-text-faint focus:outline-none"
              />
            </motion.li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <p className="mb-1.5 text-xs text-text-faint">Have an official YouTube or Twitch Clip link? Save it here.</p>
        <div className="flex gap-2">
          <input
            value={clipUrl}
            onChange={(e) => {
              setClipUrl(e.target.value);
              setClipError(null);
            }}
            placeholder="https://youtube.com/clip/..."
            className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-xs text-text placeholder:text-text-faint focus:border-accent/60 focus:outline-none"
          />
          <Button variant="secondary" size="sm" onClick={saveClipLink} disabled={!clipUrl.trim()}>
            Save
          </Button>
        </div>
        {clipError && <p className="mt-1.5 text-xs text-danger">{clipError}</p>}
      </div>
    </div>
  );
}
