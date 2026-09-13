"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, BrainCircuit, Flame, ListTree, Play, RotateCcw, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatTimecode } from "@/lib/format";
import { addSavedMoment } from "@/lib/local-store";
import type { SearchResult } from "@/lib/types";
import {
  CONTENT_TYPE_LABELS, MAX_RETRY_ROUNDS, MAX_VIDEO_SECONDS, highlightLabels, normalizeLabel, topHighlights,
} from "@/lib/analysis/shared";
import type { AnalysisState, Highlight, TopicChapter } from "@/lib/analysis/shared";

const ACTIVE = ["queued", "running"];
const STRENGTH_STYLE = {
  high: "bg-accent text-accent-ink",
  medium: "bg-accent-soft text-accent-strong",
  low: "bg-surface-hover text-text-muted",
};
const SOURCE_LABEL = { speech: "heard", visual: "seen", on_screen_text: "on-screen text", sound: "sound" };

type Selection = { kind: "highlight"; item: Highlight } | { kind: "topic"; item: TopicChapter };

function range(item: { startSeconds: number; endSeconds: number }) {
  return `${formatTimecode(item.startSeconds)}–${formatTimecode(item.endSeconds)}`;
}

export function HighlightsPanel({ video, seekTo, playerReady, onSaved }: {
  video: SearchResult; seekTo: (seconds: number) => void; playerReady: boolean; onSaved: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<AnalysisState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingRetry, setPendingRetry] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"highlights" | "topics">("highlights");
  const [labelFilter, setLabelFilter] = useState("all");
  const [sort, setSort] = useState<"time" | "strength">("time");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Selection | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [saved, setSaved] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  const storageKey = `momentscout:analysis:v2:${video.provider}:${video.id}`;
  const active = Boolean(state && ACTIVE.includes(state.status));
  const busy = submitting || pendingRetry || active || Boolean(jobId && !state && !error);

  useEffect(() => {
    let current = true;
    fetch("/api/analysis").then((res) => res.json()).then((data) => {
      if (!current) return;
      setConfigured(data.configured === true);
      setWorkerOnline(data.workerOnline === true);
    }).catch(() => { if (current) setError("Could not check the analysis service. Refresh to retry."); });
    let stored = null;
    try { stored = window.sessionStorage.getItem(storageKey); } catch { /* Storage optional. */ }
    // Restore only the job reference; analysis data stays in owner-scoped server storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobId(stored);
    return () => { current = false; };
  }, [storageKey]);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/analysis?id=${encodeURIComponent(jobId!)}`, { signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          try { sessionStorage.removeItem(storageKey); } catch { /* Storage optional. */ }
          setJobId(null); setState(null); setPendingRetry(false); setError(data.message || "Analysis expired.");
          return;
        }
        if (!response.ok) throw new Error(data.message || "Could not load analysis.");
        const next = data as AnalysisState;
        setState(next); setWorkerOnline(next.workerOnline); setError("");
        const retryStarted = ACTIVE.includes(next.status) || next.failedWindows.length === 0;
        if (retryStarted) setPendingRetry(false);
        if (ACTIVE.includes(next.status) || (pendingRetry && !retryStarted)) timer = setTimeout(poll, next.workerOnline ? 2500 : 5000);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "Could not load analysis.");
        timer = setTimeout(poll, 5000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, storageKey, pendingRetry]);

  async function analyze(retryFailed = false) {
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/analysis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: video.provider, videoId: video.id, ...(retryFailed ? { retryFailed: true } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not start analysis.");
      if (retryFailed) setPendingRetry(true);
      else if (data.id !== jobId) { setState(null); setSelected(null); }
      setJobId(data.id);
      try { sessionStorage.setItem(storageKey, data.id); } catch { /* Storage optional. */ }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start analysis.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel() {
    try {
      const response = await fetch(`/api/analysis?id=${encodeURIComponent(jobId!)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not cancel. Try again.");
      setPendingRetry(false);
      setState((previous) => previous ? { ...previous, status: "cancelled" } : previous);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel.");
    }
  }

  function inspect(selection: Selection) {
    setSelected(selection); setStart(selection.item.startSeconds); setEnd(selection.item.endSeconds); setSaved(false);
    if (playerReady) seekTo(Math.max(0, selection.item.startSeconds - 2));
    setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" }), 0);
  }

  const duration = state?.durationSeconds ?? video.durationSeconds ?? 0;
  const validRange = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= duration;
  function saveRange() {
    if (!selected || !validRange) return;
    const url = new URL(video.url);
    url.searchParams.set("t", `${Math.floor(start)}s`);
    const { item } = selected;
    const note = selected.kind === "highlight"
      ? `AI-suggested ${selected.item.label}: ${item.title}. ${item.summary}`
      : `AI topic: ${item.title}. ${item.summary}`;
    addSavedMoment({
      id: `moment_${crypto.randomUUID()}`, provider: video.provider, videoId: video.id, videoTitle: video.title, videoUrl: video.url,
      channelTitle: video.channelTitle, thumbnailUrl: video.thumbnailUrl, startSeconds: start, endSeconds: end, note,
      createdAt: new Date().toISOString(), linkType: "timestamp", savedLink: url.toString(),
    });
    setSaved(true); onSaved();
  }

  if (video.provider !== "youtube") {
    return (
      <section className="rounded-lg border border-border bg-surface p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium"><BrainCircuit size={16} /> AI video breakdown</h3>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">AI analysis currently supports public YouTube videos. Twitch playback and bookmarks remain available.</p>
      </section>
    );
  }

  const highlights = state?.highlights ?? [];
  const topics = state?.topics ?? [];
  const needle = query.trim().toLowerCase();
  const matches = (text: string) => !needle || text.toLowerCase().includes(needle);
  const labels = highlightLabels(highlights);
  const visibleHighlights = highlights
    .filter((item) => (labelFilter === "all" || normalizeLabel(item.label) === labelFilter)
      && matches(`${item.label} ${item.title} ${item.summary} ${item.evidence.description}`))
    .sort((a, b) => sort === "time" ? a.startSeconds - b.startSeconds
      : ({ high: 3, medium: 2, low: 1 }[b.strength] - { high: 3, medium: 2, low: 1 }[a.strength]) || a.startSeconds - b.startSeconds);
  const visibleTopics = topics.filter((item) => matches(`${item.title} ${item.summary}`));
  const top = topHighlights(highlights);
  const hasResults = highlights.length > 0 || topics.length > 0;
  const tooLong = (video.durationSeconds ?? 0) > MAX_VIDEO_SECONDS;
  const canRetry = state && !active && !pendingRetry && state.failedWindows.length > 0 && state.retryRounds < MAX_RETRY_ROUNDS;

  const statusText = !state ? "" : pendingRetry ? "Retrying missed sections…"
    : state.status === "queued" ? "Queued"
    : state.status === "running" ? (state.totalWindows > 1 ? `Analyzing section ${Math.min(state.completedWindows.length + 1, state.totalWindows)} of ${state.totalWindows}…` : "Watching the whole video…")
    : state.status === "complete" ? (state.failedWindows.length ? "Partly analyzed" : "Analysis complete")
    : state.status === "failed" ? "Analysis failed" : "Cancelled";

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5" aria-labelledby="ai-breakdown-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="ai-breakdown-heading" className="flex items-center gap-2 text-sm font-medium"><BrainCircuit size={16} className="text-accent" /> AI video breakdown</h3>
          <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-text-muted">AI watches the video, works out what kind of video it is, and suggests the highlights and spoken topics worth clipping.</p>
        </div>
        <span className="rounded bg-accent-soft px-2 py-1 text-[10px] text-accent">AI suggestions</span>
      </div>

      {configured === false && <p className="mt-3 rounded-md bg-surface-raised p-3 text-xs text-text-muted">AI setup is needed: add GEMINI_API_KEY to .env.local, then run <code className="font-mono">npm run dev:all</code>.</p>}
      {configured && !video.capabilities.canAnalyze && <p className="mt-3 text-xs text-text-muted">This source is not available for AI analysis. Choose a public video that allows embedding.</p>}
      {tooLong && <p className="mt-3 text-xs text-text-muted">Videos longer than two hours can&apos;t be analyzed yet.</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {state?.status !== "complete" && (
          <Button variant="primary" size="sm" onClick={() => analyze()} disabled={busy || !configured || !video.capabilities.canAnalyze || tooLong} icon={<Sparkles size={13} />}>
            {submitting ? "Starting…" : active || pendingRetry ? "Analyzing…" : state ? "Analyze again" : "Analyze video"}
          </Button>
        )}
        {(active || pendingRetry) && jobId && <Button size="sm" onClick={cancel}>Cancel</Button>}
        <span className="text-[11px] text-text-muted">Up to 2 hours · uses your Gemini quota</span>
      </div>
      <p className="mt-2 text-[11px] text-text-muted">The public video link is sent to Google Gemini, which analyzes its audio and frames. Results are kept for 24 hours.</p>
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}

      {state && (
        <div className="mt-5" aria-live="polite">
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <span>{statusText}</span>
            {state.totalWindows > 1 && <span className="font-mono text-text-muted">{formatTimecode(state.coveredSeconds)} / {formatTimecode(state.durationSeconds)}</span>}
          </div>
          {state.totalWindows > 1
            ? <progress className="mt-2 h-1.5 w-full accent-accent" value={state.coveredSeconds} max={state.durationSeconds} aria-label="Video duration analyzed" />
            : (active || pendingRetry) && <p className="mt-1 text-[11px] text-text-muted">The whole video is analyzed in one request, so there is no step-by-step progress. Longer videos take longer.</p>}
          {(active || pendingRetry) && workerOnline === false && (
            <p className="mt-2 rounded-md bg-surface-raised p-2.5 text-xs text-text-muted">The analysis worker isn&apos;t running, so nothing is being analyzed. Start it with <code className="font-mono">npm run dev:all</code>, or run <code className="font-mono">npm run analysis:worker</code> in a second terminal.</p>
          )}
          {state.message && <p className="mt-2 text-xs text-danger">{state.message}</p>}
          {canRetry && <Button className="mt-2" size="sm" onClick={() => analyze(true)} icon={<RotateCcw size={12} />}>Retry missed sections</Button>}
        </div>
      )}

      {state?.profile && (
        <div className="mt-4 rounded-md border border-border bg-surface-raised p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent-strong">{CONTENT_TYPE_LABELS[state.profile.contentType]}</span>
            <span className="font-medium">{state.profile.contentLabel}</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">{state.profile.summary}</p>
          <p className="mt-1 text-[10px] text-text-faint">Video type detected by AI from the footage.</p>
        </div>
      )}

      {top.length > 0 && (
        <div className="mt-4">
          <h4 className="flex items-center gap-1.5 text-xs font-medium"><Flame size={13} className="text-accent" /> Top clip candidates</h4>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {top.map((item, index) => (
              <li key={`${item.startSeconds}-${index}`}>
                <button type="button" onClick={() => inspect({ kind: "highlight", item })} className="h-full w-full rounded-md border border-border bg-surface-raised p-2.5 text-left hover:border-accent/50 focus-visible:border-accent">
                  <span className="font-mono text-[11px] text-accent">{range(item)}</span>
                  <span className="mt-1 block text-xs font-medium">{item.title}</span>
                  <span className="mt-1 block text-[10px] text-text-muted">{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[10px] text-text-faint">Ranked by AI from what is seen and heard. This is not YouTube&apos;s “Most replayed” data, which YouTube doesn&apos;t share with apps.</p>
        </div>
      )}

      {hasResults && state && (
        <>
          <div className="relative mt-4 h-7 overflow-hidden rounded bg-surface-raised" aria-label="Highlights and topics timeline">
            {topics.map((item, index) => (
              <button key={`t-${index}`} type="button" onClick={() => inspect({ kind: "topic", item })} aria-label={`Topic ${item.title}, ${range(item)}`} title={item.title}
                className={`absolute top-0 h-2 ${index % 2 ? "bg-text-faint/30" : "bg-text-faint/50"} hover:bg-text-muted focus-visible:bg-text-muted`}
                style={{ left: `${(item.startSeconds / state.durationSeconds) * 100}%`, width: `${((item.endSeconds - item.startSeconds) / state.durationSeconds) * 100}%` }} />
            ))}
            {highlights.map((item, index) => (
              <button key={`h-${index}`} type="button" onClick={() => inspect({ kind: "highlight", item })} aria-label={`${item.label}: ${item.title} at ${formatTimecode(item.startSeconds)}`} title={`${item.label}: ${item.title}`}
                className={`absolute bottom-1 top-3 min-w-1 rounded-sm ${item.strength === "high" ? "bg-accent" : "bg-accent/50"} hover:bg-accent-strong focus-visible:bg-accent-strong`}
                style={{ left: `${(item.startSeconds / state.durationSeconds) * 100}%`, width: `${((item.endSeconds - item.startSeconds) / state.durationSeconds) * 100}%` }} />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip active={tab === "highlights"} aria-pressed={tab === "highlights"} icon={<Sparkles size={12} />} onClick={() => setTab("highlights")}>Highlights ({highlights.length})</Chip>
            <Chip active={tab === "topics"} aria-pressed={tab === "topics"} icon={<ListTree size={12} />} onClick={() => setTab("topics")}>Topics ({topics.length})</Chip>
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2">
            <Search size={13} className="text-text-muted" />
            <input aria-label="Search highlights and topics" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search what was said or shown…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
          </label>

          {tab === "highlights" ? (
            <>
              {labels.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Filter by highlight type">
                  <Chip active={labelFilter === "all"} aria-pressed={labelFilter === "all"} onClick={() => setLabelFilter("all")}>All</Chip>
                  {labels.map((entry) => <Chip key={entry.key} active={labelFilter === entry.key} aria-pressed={labelFilter === entry.key} onClick={() => setLabelFilter(entry.key)}>{entry.label} ({entry.count})</Chip>)}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                <span>{visibleHighlights.length} highlight{visibleHighlights.length === 1 ? "" : "s"}</span>
                <span className="flex gap-1">
                  <Chip active={sort === "time"} aria-pressed={sort === "time"} onClick={() => setSort("time")}>In order</Chip>
                  <Chip active={sort === "strength"} aria-pressed={sort === "strength"} onClick={() => setSort("strength")}>Strongest first</Chip>
                </span>
              </div>
              <ul className="mt-2 max-h-[28rem] divide-y divide-border overflow-y-auto">
                {visibleHighlights.map((item, index) => (
                  <li key={`${item.startSeconds}-${index}`} className="flex items-start gap-3 py-3">
                    <button type="button" onClick={() => inspect({ kind: "highlight", item })} className="shrink-0 rounded bg-accent-soft px-2 py-1 font-mono text-[11px] text-accent" aria-label={`Review ${item.title} at ${formatTimecode(item.startSeconds)}`}>{formatTimecode(item.startSeconds)}</button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded border border-border-strong px-1.5 py-0.5 text-[10px] text-text-muted">{item.label}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${STRENGTH_STYLE[item.strength]}`}>{item.strength} clip potential</span>
                      </div>
                      <button type="button" onClick={() => inspect({ kind: "highlight", item })} className="mt-1 text-left text-sm font-medium hover:text-accent">{item.title}</button>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.summary}</p>
                      <p className="mt-1 text-[10px] text-text-faint">{range(item)} · {formatTimecode(item.endSeconds - item.startSeconds)} long</p>
                    </div>
                  </li>
                ))}
              </ul>
              {visibleHighlights.length === 0 && <p className="py-4 text-xs text-text-muted">{highlights.length ? "No highlights match this filter." : "No highlights were suggested for the analyzed footage."}</p>}
            </>
          ) : (
            <>
              <ul className="mt-3 max-h-[28rem] divide-y divide-border overflow-y-auto">
                {visibleTopics.map((item, index) => (
                  <li key={`${item.startSeconds}-${index}`} className="flex items-start gap-3 py-3">
                    <button type="button" onClick={() => inspect({ kind: "topic", item })} className="shrink-0 rounded bg-surface-hover px-2 py-1 font-mono text-[11px] text-text" aria-label={`Review topic ${item.title} at ${formatTimecode(item.startSeconds)}`}>{formatTimecode(item.startSeconds)}</button>
                    <div className="min-w-0 flex-1">
                      <button type="button" onClick={() => inspect({ kind: "topic", item })} className="text-left text-sm font-medium hover:text-accent">{item.title}</button>
                      <p className="mt-1 text-xs leading-relaxed text-text-muted">{item.summary}</p>
                      <p className="mt-1 text-[10px] text-text-faint">{range(item)}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {visibleTopics.length === 0 && <p className="py-4 text-xs text-text-muted">{topics.length ? "No topics match this search." : state.profile?.speechDriven === false ? "This video has little meaningful speech, so no spoken topics were mapped." : "No spoken topics were mapped for the analyzed footage."}</p>}
            </>
          )}
          <p className="mt-2 text-[11px] text-text-muted">
            Timestamps, summaries, and evidence are AI estimates written as paraphrases, not quotes. Preview before clipping.
            {state.rejectedSuggestions > 0 && ` ${state.rejectedSuggestions} suggestion${state.rejectedSuggestions === 1 ? " was" : "s were"} discarded for invalid timestamps.`}
          </p>
        </>
      )}
      {state?.status === "complete" && !hasResults && state.failedWindows.length === 0 && (
        <p className="mt-4 text-xs text-text-muted">The analysis finished without suggesting highlights or topics. That doesn&apos;t prove nothing notable happens in the video.</p>
      )}

      {selected && (
        <div ref={reviewRef} className="mt-4 rounded-md border border-border-strong bg-surface-raised p-3">
          <p className="text-[10px] uppercase tracking-wide text-text-faint">{selected.kind === "highlight" ? `${selected.item.label} · ${selected.item.strength} clip potential` : "Topic chapter"}</p>
          <h4 className="mt-1 text-sm font-medium">{selected.item.title}</h4>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{selected.item.summary}</p>
          {selected.kind === "highlight" && (
            <p className="mt-2 text-xs text-text-muted">
              <button type="button" disabled={!playerReady} onClick={() => seekTo(selected.item.evidence.atSeconds)} className="font-mono text-accent disabled:text-text-muted">{formatTimecode(selected.item.evidence.atSeconds)}</button>
              {" "}· {SOURCE_LABEL[selected.item.evidence.source]}: {selected.item.evidence.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-[11px] text-text-muted">Start (seconds)<input type="number" min="0" max={duration} step="0.1" value={start} onChange={(event) => { setStart(event.target.valueAsNumber); setSaved(false); }} className="mt-1 block w-24 rounded border border-border bg-bg px-2 py-1.5 text-xs text-text" /></label>
            <label className="text-[11px] text-text-muted">End (seconds)<input type="number" min="0" max={duration} step="0.1" value={end} onChange={(event) => { setEnd(event.target.valueAsNumber); setSaved(false); }} className="mt-1 block w-24 rounded border border-border bg-bg px-2 py-1.5 text-xs text-text" /></label>
            <Button size="sm" disabled={!playerReady || !validRange} onClick={() => seekTo(Math.max(0, start - 2))} icon={<Play size={12} />}>Preview with lead-in</Button>
            <Button size="sm" variant="primary" disabled={!validRange || saved} onClick={saveRange} icon={<Bookmark size={12} />}>{saved ? "Saved" : "Save range"}</Button>
          </div>
          {!validRange && <p className="mt-2 text-xs text-danger">Choose a start before the end, within the video duration.</p>}
          <p className="mt-2 text-[11px] text-text-muted">Saves a timestamp and range to Collections. Playback continues past the end, and this does not export a clip.</p>
        </div>
      )}
    </section>
  );
}
