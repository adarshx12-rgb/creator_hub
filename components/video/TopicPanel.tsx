"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, BrainCircuit, Crosshair, Play, Search, Tags } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { formatTimecode } from "@/lib/format";
import { addSavedMoment } from "@/lib/local-store";
import type { SearchResult } from "@/lib/types";
import type { AnalysisMode, AnalysisSegment, AnalysisState } from "@/lib/analysis/schema";

const EVENT_LABELS = { topic: "Topic", kill: "Kill", round_win: "Round win", ace: "Ace", clutch: "Clutch", other: "Other" };
const ACTIVE = ["queued", "running"];

export function TopicPanel({ video, seekTo, playerReady, onSaved }: {
  video: SearchResult; seekTo: (seconds: number) => void; playerReady: boolean; onSaved: () => void;
}) {
  const [mode, setMode] = useState<AnalysisMode>("topics");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [state, setState] = useState<AnalysisState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [selected, setSelected] = useState<AnalysisSegment | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [saved, setSaved] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  const storageKey = `momentscout:analysis:${video.provider}:${video.id}:${mode}`;
  const busy = submitting || Boolean(jobId && !state && !error) || Boolean(state && ACTIVE.includes(state.status));

  useEffect(() => {
    let active = true;
    fetch("/api/analysis").then((res) => res.json()).then((data) => {
      if (active) setConfigured(data.configured === true);
    }).catch(() => { if (active) setError("Could not check the analysis service. Refresh to retry."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    // Restore the job reference only; analysis data stays in owner-scoped server storage.
    let stored = null;
    try { stored = window.sessionStorage.getItem(storageKey); } catch { /* Storage optional. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJobId(stored);
    setState(null); setSelected(null); setError(""); setKind("all"); setQuery("");
  }, [storageKey]);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/analysis?id=${encodeURIComponent(jobId!)}`, { signal: controller.signal });
        const data = await response.json();
        if (response.status === 404) {
          try { sessionStorage.removeItem(storageKey); } catch { /* Storage optional. */ }
          setJobId(null); setError(data.message || "Analysis expired."); return;
        }
        if (!response.ok) throw new Error(data.message || "Could not load analysis.");
        if (controller.signal.aborted) return;
        setState(data); setError("");
        if (ACTIVE.includes(data.status)) timer = setTimeout(poll, 2500);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : "Could not load analysis.");
          timer = setTimeout(poll, 5000);
        }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [jobId, storageKey]);

  async function analyze() {
    setSubmitting(true); setError("");
    try {
      const response = await fetch("/api/analysis", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: video.provider, videoId: video.id, mode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Could not start analysis.");
      if (data.id !== jobId) setState({ id: data.id, mode, durationSeconds: video.durationSeconds ?? 0,
        status: "queued", completedWindows: 0, totalWindows: Math.ceil((video.durationSeconds ?? 0) / (mode === "topics" ? 600 : 120)),
        coveredSeconds: 0, segments: [], updatedAt: new Date().toISOString() });
      setSelected(null); setJobId(data.id);
      try { sessionStorage.setItem(storageKey, data.id); } catch { /* Storage optional. */ }
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start analysis."); }
    finally { setSubmitting(false); }
  }

  async function cancel() {
    try {
      const response = await fetch(`/api/analysis?id=${encodeURIComponent(jobId!)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not cancel. Try again.");
      setState((previous) => previous ? { ...previous, status: "cancelled" } : previous);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not cancel."); }
  }

  function inspect(segment: AnalysisSegment) {
    setSelected(segment); setStart(segment.startSeconds); setEnd(segment.endSeconds); setSaved(false);
    if (playerReady) seekTo(Math.max(0, segment.startSeconds - 2));
    setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "auto", block: "nearest" }), 0);
  }
  const validRange = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start && end <= (state?.durationSeconds ?? 0);
  function saveRange() {
    if (!selected || !validRange) return;
    const url = new URL(video.url); url.searchParams.set("t", `${Math.floor(start)}s`);
    addSavedMoment({ id: `moment_${crypto.randomUUID()}`, provider: video.provider, videoId: video.id,
      videoTitle: video.title, videoUrl: video.url, channelTitle: video.channelTitle, thumbnailUrl: video.thumbnailUrl,
      startSeconds: start, endSeconds: end, note: `AI-suggested ${EVENT_LABELS[selected.kind]}: ${selected.title}. ${selected.summary}`,
      createdAt: new Date().toISOString(), linkType: "timestamp", savedLink: url.toString() });
    setSaved(true); onSaved();
  }
  const segments = state?.segments ?? [];
  const filtered = segments.filter((segment) => (kind === "all" || kind === segment.kind) &&
    `${segment.title} ${segment.summary} ${segment.evidence.map((item) => item.description).join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  if (video.provider !== "youtube") return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h3 className="flex items-center gap-2 text-sm font-medium"><BrainCircuit size={16} /> AI video analysis</h3>
      <p className="mt-2 text-xs leading-relaxed text-text-muted">AI analysis currently supports public YouTube videos. Twitch source playback and bookmarks remain available; Twitch file analysis is not connected yet.</p>
    </section>
  );

  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="flex items-center gap-2 text-sm font-medium"><BrainCircuit size={16} className="text-accent" /> Find moments with AI</h3>
          <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-text-muted">Map spoken topics or locate gameplay events across the video, then review the surrounding footage.</p></div>
        <span className="rounded bg-accent-soft px-2 py-1 text-[10px] text-accent">AI suggestions</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Chip active={mode === "topics"} disabled={busy} icon={<Tags size={12} />} onClick={() => setMode("topics")}>Spoken topics</Chip>
        <Chip active={mode === "gameplay"} disabled={busy} icon={<Crosshair size={12} />} onClick={() => setMode("gameplay")}>Gameplay events</Chip>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-text-muted">{mode === "topics"
        ? "Find where subjects such as discipline, business, or training are discussed. Topic summaries are paraphrases."
        : "Look for kills, round wins, aces, and clutches using the kill feed, HUD, and result banners. Fast or obscured actions can be missed."}</p>
      {configured === false && <p className="mt-3 rounded-md bg-surface-raised p-3 text-xs text-text-muted">AI setup is needed: add GEMINI_API_KEY, then run npm run analysis:worker alongside the website.</p>}
      {configured && !video.capabilities.canAnalyze && <p className="mt-3 text-xs text-text-muted">This source is not available for AI analysis. Refresh after configuring the server, or choose a publicly accessible video.</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" onClick={analyze} disabled={busy || !configured || !video.capabilities.canAnalyze || (video.durationSeconds ?? 0) > 7200} icon={<BrainCircuit size={13} />}>
          {submitting ? "Queuing…" : state?.status === "complete" ? "Load analysis" : state?.status === "failed" || state?.status === "cancelled" ? "Start new analysis" : "Analyze entire video"}
        </Button>
        <span className="text-[11px] text-text-muted">Up to 2 hours · Gemini usage applies</span>
        {busy && jobId && <Button size="sm" onClick={cancel}>Cancel</Button>}
      </div>
      <p className="mt-2 text-[11px] text-text-muted">The video URL is sent to Google Gemini for audio and visual analysis. Results are retained for 24 hours.</p>
      {error && <p role="alert" className="mt-3 text-xs text-danger">{error}</p>}

      {state && <div className="mt-5" aria-live="polite">
        <div className="flex flex-wrap justify-between gap-2 text-xs"><span>{state.status === "complete" ? "Full scan complete" : state.status === "queued" ? "Queued — waiting for analysis worker" : state.status === "running" ? "Analyzing video…" : state.status === "failed" ? "Analysis stopped — partial results" : "Cancelled — partial results"}</span><span className="font-mono text-text-muted">{formatTimecode(state.coveredSeconds)} / {formatTimecode(state.durationSeconds)}</span></div>
        <progress className="mt-2 h-1.5 w-full accent-accent" value={state.coveredSeconds} max={state.durationSeconds} aria-label="Video duration analyzed" />
        {state.status === "queued" && <p className="mt-2 text-xs text-text-muted">Keep the background worker running. You can leave this page and return in this browser tab.</p>}
        {state.message && <p className="mt-2 text-xs text-danger">{state.message}</p>}
      </div>}

      {segments.length > 0 && <>
        <div className="relative mt-4 h-8 overflow-hidden rounded bg-surface-raised" aria-label="Suggested moments timeline">
          {segments.map((segment, index) => <button key={index} type="button" onClick={() => inspect(segment)} title={`${segment.title} at ${formatTimecode(segment.startSeconds)}`} aria-label={`Review ${segment.title} at ${formatTimecode(segment.startSeconds)}`} className="absolute inset-y-1 min-w-1 rounded-sm bg-accent/55 hover:bg-accent focus:bg-accent" style={{ left: `${segment.startSeconds / state!.durationSeconds * 100}%`, width: `${(segment.endSeconds - segment.startSeconds) / state!.durationSeconds * 100}%` }} />)}
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 py-2"><Search size={13} className="text-text-muted" /><input aria-label="Search analyzed topics and events" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search these moments…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></label>
        {mode === "gameplay" && <div className="mt-3 flex flex-wrap gap-1.5"><Chip active={kind === "all"} onClick={() => setKind("all")}>All</Chip>{Object.entries(EVENT_LABELS).filter(([key]) => key !== "topic").map(([key, label]) => <Chip key={key} active={kind === key} onClick={() => setKind(key)}>{label}</Chip>)}</div>}
        <p className="mt-3 text-[11px] text-text-muted">{filtered.length} suggestions · Timestamps and evidence are AI estimates. Review before clipping.</p>
        <ul className="mt-2 max-h-96 divide-y divide-border overflow-y-auto">
          {filtered.map((segment, index) => <li key={`${segment.startSeconds}-${index}`} className="py-3">
            <div className="flex items-start gap-3"><button type="button" onClick={() => inspect(segment)} className="shrink-0 rounded bg-accent-soft px-2 py-1 font-mono text-[11px] text-accent">{formatTimecode(segment.startSeconds)}</button><div className="min-w-0 flex-1"><button type="button" onClick={() => inspect(segment)} className="text-left text-sm font-medium hover:text-accent">{segment.title}</button><p className="mt-1 text-xs leading-relaxed text-text-muted">{segment.summary}</p><p className="mt-1 text-[10px] text-text-muted">{EVENT_LABELS[segment.kind]} · {formatTimecode(segment.endSeconds - segment.startSeconds)} · AI confidence: {segment.confidence}</p></div></div>
          </li>)}
        </ul>
        {filtered.length === 0 && <p className="py-4 text-xs text-text-muted">No analyzed moments match this filter.</p>}
      </>}
      {state?.status === "complete" && segments.length === 0 && <p className="mt-4 text-xs text-text-muted">The scan completed without supported {mode === "topics" ? "spoken topics" : "gameplay events"}. This does not prove none occur in the video.</p>}

      {selected && <div ref={reviewRef} className="mt-4 rounded-md border border-border-strong bg-surface-raised p-3">
        <h4 className="text-sm font-medium">Review: {selected.title}</h4>
        <ul className="mt-2 space-y-1 text-xs text-text-muted">{selected.evidence.map((item, index) => <li key={index}><span className="font-mono">{formatTimecode(item.atSeconds)}</span> · {item.source.replaceAll("_", " ")}: {item.description}</li>)}</ul>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-text-muted">Start (seconds)<input type="number" min="0" max={state?.durationSeconds} step="0.1" value={start} onChange={(event) => { setStart(event.target.valueAsNumber); setSaved(false); }} className="mt-1 block w-24 rounded border border-border bg-bg px-2 py-1.5 text-xs text-text" /></label>
          <label className="text-[11px] text-text-muted">End (seconds)<input type="number" min="0" max={state?.durationSeconds} step="0.1" value={end} onChange={(event) => { setEnd(event.target.valueAsNumber); setSaved(false); }} className="mt-1 block w-24 rounded border border-border bg-bg px-2 py-1.5 text-xs text-text" /></label>
          <Button size="sm" disabled={!playerReady || !validRange} onClick={() => seekTo(Math.max(0, start - 2))} icon={<Play size={12} />}>Preview context</Button>
          <Button size="sm" variant="primary" disabled={!validRange || saved} onClick={saveRange} icon={<Bookmark size={12} />}>{saved ? "Saved" : "Save range"}</Button>
        </div>
        {!validRange && <p className="mt-2 text-xs text-danger">Choose a start before the end, within the video duration.</p>}
        <p className="mt-2 text-[11px] text-text-muted">Saves a timestamp and selected range to Collections. Playback continues beyond the end; this does not export a clip.</p>
      </div>}
      <div className="mt-5 border-t border-border pt-3"><h4 className="text-xs font-medium">Most replayed</h4><p className="mt-1 text-xs leading-relaxed text-text-muted">Replay data is unavailable for this source. YouTube channel-owner analytics are not connected. AI-selected moments are not replay statistics.</p></div>
    </section>
  );
}
