"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TrimControls } from "@/components/studio/TrimControls";
import { formatTimecode } from "@/lib/format";
import type { SearchResult } from "@/lib/types";

const PRESETS = [15, 30, 60];
const QUALITY_LABEL = { "720": "720p", "1080": "1080p", best: "Best available" } as const;
type Quality = keyof typeof QUALITY_LABEL;

interface Job {
  id: string;
  status: "running" | "complete" | "failed";
  error: string | null;
  fileName: string;
}

// Personal-use only: rendered when PERSONAL_DOWNLOADS=1, and the API also refuses non-localhost requests.
export function ClipDownloadPanel({ video, currentTime, playerReady, scrubTo, previewRange }: {
  video: SearchResult; currentTime: number; playerReady: boolean;
  scrubTo: (seconds: number) => void; previewRange: (start: number, end: number) => void;
}) {
  const duration = video.durationSeconds ?? 0;
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(Math.min(duration, 30));
  const [quality, setQuality] = useState<Quality>("1080");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const setRange = useCallback((nextStart: number, nextEnd: number) => {
    const s = Math.max(0, Math.min(nextStart, duration));
    const e = Math.max(0, Math.min(nextEnd, duration));
    // Glide the player to whichever handle moved so the frame under it is visible.
    if (playerReady) {
      if (s !== start) scrubTo(s);
      else if (e !== end) scrubTo(e);
    }
    setStart(s);
    setEnd(e);
    setJob(null);
    setError("");
  }, [duration, playerReady, scrubTo, start, end]);

  useEffect(() => {
    if (job?.status !== "running") return;
    const began = Date.now();
    const timer = setInterval(async () => {
      setElapsed(Math.round((Date.now() - began) / 1000));
      try {
        const response = await fetch(`/api/download?id=${job.id}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) { setError(data.message || "Lost track of this download."); setJob(null); return; }
        if (data.status !== "running") setJob(data);
      } catch {
        // Transient network error - keep polling.
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [job?.id, job?.status]);

  if (video.provider !== "youtube" || duration <= 0) return null;
  const validRange = start >= 0 && end > start && end <= duration;

  async function download() {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/download", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id, startSeconds: start, endSeconds: end, quality }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not start the download.");
      setElapsed(0);
      setJob(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the download.");
    } finally {
      setSubmitting(false);
    }
  }

  const timeInput = (label: string, value: number, onValue: (v: number) => void) => (
    <label className="text-[11px] text-text-muted">{label}
      <input type="number" min={0} max={duration} step={0.1} value={Math.round(value * 10) / 10}
        onChange={(event) => { if (Number.isFinite(event.target.valueAsNumber)) onValue(event.target.valueAsNumber); }}
        className="mt-1 block w-24 rounded border border-border bg-bg px-2 py-1.5 font-mono text-xs text-text" />
    </label>
  );

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5" aria-labelledby="clip-download-heading">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 id="clip-download-heading" className="flex items-center gap-2 text-sm font-medium"><Download size={16} className="text-accent" /> Download clip</h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-muted">Drag the handles to glide through the video, then download just that range as MP4.</p>
        </div>
        <span className="rounded bg-surface-raised px-2 py-1 text-[10px] text-text-muted">Personal use</span>
      </div>

      <TrimControls duration={duration} start={start} end={end} currentTime={currentTime}
        onChange={setRange} onScrub={(time) => playerReady && scrubTo(time)} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {timeInput("Start (s)", start, (v) => setRange(v, Math.max(end, v + 0.5)))}
        {timeInput("End (s)", end, (v) => setRange(Math.min(start, v - 0.5), v))}
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" disabled={!playerReady} onClick={() => setRange(Math.min(currentTime, end - 0.5), end)}>Start = now</Button>
          <Button size="sm" variant="ghost" disabled={!playerReady} onClick={() => setRange(start, Math.max(currentTime, start + 0.5))}>End = now</Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] text-text-muted">Length</span>
        {PRESETS.map((seconds) => (
          <Button key={seconds} size="sm" variant="secondary" disabled={start + 1 > duration}
            onClick={() => setRange(start, Math.min(duration, start + seconds))}>{seconds}s</Button>
        ))}
        <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={() => setRange(0, duration)}>Whole video</Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button size="sm" disabled={!playerReady || !validRange} icon={<Play size={12} />} onClick={() => previewRange(start, end)}>Preview</Button>
        <label className="sr-only" htmlFor="clip-quality">Quality</label>
        <select id="clip-quality" value={quality} onChange={(event) => { setQuality(event.target.value as Quality); setJob(null); }}
          className="h-8 rounded-md border border-border-strong bg-bg px-2 text-xs text-text">
          {Object.entries(QUALITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <Button size="sm" variant="primary" disabled={!validRange || submitting || job?.status === "running"}
          icon={job?.status === "running" || submitting ? <LoaderCircle size={12} className="animate-spin" /> : <Download size={12} />}
          onClick={download}>
          Download {formatTimecode(Math.max(0, end - start))}
        </Button>
      </div>

      <div aria-live="polite" className="mt-3 text-xs">
        {job?.status === "running" && <p className="text-text-muted">Downloading and cutting {formatTimecode(start)}–{formatTimecode(end)}… {elapsed}s</p>}
        {job?.status === "complete" && (
          <a href={`/api/download?id=${job.id}&file=1`} download={job.fileName}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-3 py-2 font-medium text-accent hover:underline">
            <Download size={13} /> Save {job.fileName}
          </a>
        )}
        {(error || job?.status === "failed") && <p role="alert" className="text-danger">{error || job?.error}</p>}
      </div>
    </section>
  );
}
