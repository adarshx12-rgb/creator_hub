"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, FolderOpen, Link2, Play, Trash2, UploadCloud } from "lucide-react";
import { formatTimecode } from "@/lib/format";
import { getSavedMoments, getUploadedAssets, removeSavedMoment, removeUploadedAsset } from "@/lib/local-store";
import type { SavedMoment, UploadedAsset } from "@/lib/types";

function groupByVideo(moments: SavedMoment[]): Map<string, SavedMoment[]> {
  const map = new Map<string, SavedMoment[]>();
  for (const moment of moments) {
    const key = `${moment.provider}:${moment.videoId}`;
    const group = map.get(key) ?? [];
    group.push(moment);
    map.set(key, group);
  }
  return map;
}

export function CollectionsView() {
  const [moments, setMoments] = useState<SavedMoment[]>([]);
  const [uploads, setUploads] = useState<UploadedAsset[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // One-time hydration from localStorage, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMoments(getSavedMoments());
    setUploads(getUploadedAssets());
    setLoaded(true);
  }, []);

  const groups = useMemo(() => groupByVideo(moments), [moments]);

  if (!loaded) return null;

  if (groups.size === 0 && uploads.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <FolderOpen size={22} className="text-text-faint" />
        <h1 className="text-sm font-medium text-text">No saved moments yet</h1>
        <p className="text-sm leading-relaxed text-text-muted">
          Search for footage, open a source, and save a timestamp or an official Clip link to build your
          collection.
        </p>
        <Link href="/" className="mt-1 text-sm text-accent-strong hover:underline">
          Start searching
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <h1 className="font-display text-xl font-medium text-text">Collections</h1>
      <p className="mt-1 text-sm text-text-muted">Saved sources, timestamps, and your local uploads.</p>

      {groups.size > 0 && (
        <div className="mt-6 space-y-4">
          {Array.from(groups.entries()).map(([key, group]) => {
            const first = group[0];
            const videoHref = `/video/${first.provider}/${first.videoId}`;
            return (
              <div key={key} className="flex gap-4 rounded-lg border border-border bg-surface p-4">
                <Link href={videoHref} className="relative hidden aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-surface-raised sm:block">
                  {first.thumbnailUrl && <Image src={first.thumbnailUrl} alt="" fill className="object-cover" />}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={videoHref} className="line-clamp-1 text-sm font-medium text-text hover:text-accent-strong">
                    {first.videoTitle}
                  </Link>
                  <p className="mt-0.5 text-xs text-text-muted">{first.channelTitle}</p>
                  <ul className="mt-3 space-y-1.5">
                    {group.map((moment) => (
                      <li key={moment.id} className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex min-w-0 items-center gap-2">
                          {moment.linkType === "official_clip" ? (
                            <span className="flex shrink-0 items-center gap-1 rounded bg-verified/15 px-1.5 py-0.5 font-mono text-verified">
                              <Link2 size={10} /> Clip
                            </span>
                          ) : moment.startSeconds !== null ? (
                            <Link
                              href={`${videoHref}?t=${moment.startSeconds}`}
                              className="flex shrink-0 items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-accent-strong"
                            >
                              <Play size={10} /> {formatTimecode(moment.startSeconds)}
                              {moment.endSeconds !== null && `–${formatTimecode(moment.endSeconds)}`}
                            </Link>
                          ) : (
                            <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-text-faint">
                              Source
                            </span>
                          )}
                          {moment.note && <span className="truncate text-text-muted">{moment.note}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => setMoments(removeSavedMoment(moment.id))}
                          className="shrink-0 text-text-faint hover:text-danger"
                          aria-label="Remove"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {uploads.length > 0 && (
        <div className="mt-10">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-text">
            <UploadCloud size={15} /> Your uploads
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {uploads.map((asset) => (
              <div key={asset.id} className="rounded-lg border border-border bg-surface p-3">
                <p className="truncate text-xs font-medium text-text">{asset.fileName}</p>
                <p className="mt-1 text-[0.7rem] text-text-faint">
                  {asset.durationSeconds ? formatTimecode(asset.durationSeconds) : "Duration unknown"}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <Link href="/studio" className="flex items-center gap-1 text-[0.7rem] text-accent-strong hover:underline">
                    Open in Studio <ExternalLink size={10} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setUploads(removeUploadedAsset(asset.id))}
                    className="text-text-faint hover:text-danger"
                    aria-label="Remove upload"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
