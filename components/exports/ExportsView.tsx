"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleAlert, PackageOpen, Trash2 } from "lucide-react";
import { formatRelativeDate, formatTimecode } from "@/lib/format";
import { getExportJobs, removeExportJob } from "@/lib/local-store";
import type { ExportJob } from "@/lib/types";

const STATUS_LABEL: Record<ExportJob["status"], string> = {
  queued: "Queued",
  blocked: "Blocked",
  failed: "Failed",
};

const STATUS_CLASS: Record<ExportJob["status"], string> = {
  queued: "bg-accent-soft text-accent-strong",
  blocked: "bg-surface-hover text-text-muted",
  failed: "bg-danger/15 text-danger",
};

export function ExportsView() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // One-time hydration from localStorage, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobs(getExportJobs());
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  if (jobs.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
        <PackageOpen size={22} className="text-text-faint" />
        <h1 className="text-sm font-medium text-text">No export jobs yet</h1>
        <p className="text-sm leading-relaxed text-text-muted">
          Trim a clip in Studio and export it to see its job status here.
        </p>
        <Link href="/studio" className="mt-1 text-sm text-accent-strong hover:underline">
          Go to Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
      <h1 className="font-display text-xl font-medium text-text">Exports</h1>
      <p className="mt-1 text-sm text-text-muted">
        Export jobs queued from Studio. Rendering requires the FFmpeg processing worker, which isn&apos;t
        connected in this build - see the README for what&apos;s left to wire up.
      </p>

      <div className="mt-6 space-y-3">
        {jobs.map((job) => (
          <div key={job.id} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-surface p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[0.7rem] font-medium ${STATUS_CLASS[job.status]}`}>
                  {STATUS_LABEL[job.status]}
                </span>
                <span className="truncate text-sm text-text">{job.assetName}</span>
              </div>
              <p className="mt-1.5 font-mono text-xs tabular-nums text-text-faint">
                {formatTimecode(job.selection.startSeconds)} - {formatTimecode(job.selection.endSeconds)} ·{" "}
                {job.selection.crop} · queued {formatRelativeDate(job.createdAt)}
              </p>
              <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-text-muted">
                <CircleAlert size={12} className="mt-0.5 shrink-0" /> {job.statusMessage}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setJobs(removeExportJob(job.id))}
              aria-label="Remove job"
              className="shrink-0 text-text-faint hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
