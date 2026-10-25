"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { Uploader, validateUpload } from "./Uploader";
import { CaptionEditor, CaptionOverlay } from "./CaptionEditor";
import { resolveCaptionDesign, styleCaption, validateCues, defaultCaptionDesign, type CaptionCue, type CaptionDesign } from "@/lib/captions";
import { PreviewStage } from "./PreviewStage";
import { CaptionTimeline } from "./CaptionTimeline";
import { TrimControls } from "./TrimControls";
import { CropModeSelector } from "./CropModeSelector";
import { ExportSettingsPanel, type ExportQuality } from "./ExportSettingsPanel";
import { Button } from "@/components/ui/Button";
import { formatTimecode } from "@/lib/format";
import {
  addExportJob,
  updateExportJob,
  addUploadedAsset,
  getUploadedAssets,
  removeUploadedAsset,
  updateUploadedAsset,
} from "@/lib/local-store";
import type { CropMode, ExportJob, UploadedAsset } from "@/lib/types";

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function StudioView() {
  const [assets, setAssets] = useState<UploadedAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [crop, setCrop] = useState<CropMode>("original");
  const [fitBackground, setFitBackground] = useState(false);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [renderId, setRenderId] = useState<string | null>(null);
  const [exportComplete, setExportComplete] = useState(false);
  const [exportQuality, setExportQuality] = useState<ExportQuality>('compatible');
  const exportController = useRef<AbortController | null>(null);
  const exportFonts = useRef(new Map<string, File>());

  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [selectedCaption, setSelectedCaption] = useState(-1);
  const [captionTracks, setCaptionTracks] = useState<Record<string, { cues: CaptionCue[]; design: CaptionDesign }>>({});
  const track = captionTracks[selectedId ?? ""] ?? { cues: [], design: defaultCaptionDesign };
  function updateTrack(patch: Partial<typeof track>) {
    if (selectedId) setCaptionTracks(previous => ({ ...previous, [selectedId]: { ...(previous[selectedId] ?? { cues: [], design: defaultCaptionDesign }), ...patch } }));
  }

  function updateCaptionDesign(index: number, design: CaptionDesign) {
    if (!selectedId) return;
    setCaptionTracks(previous => {
      const current = previous[selectedId] ?? { cues: [], design: defaultCaptionDesign };
      return { ...previous, [selectedId]: { ...current, cues: styleCaption(current.cues, index, design) } };
    });
  }
  const editorDesign = resolveCaptionDesign(track.cues[selectedCaption], track.design);

  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const existing = getUploadedAssets();
    // One-time hydration from localStorage, which isn't available during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAssets(existing);
    setSelectedId(existing[0]?.id ?? null);
    setLoaded(true);
  }, []);

  const selectedAsset = assets.find((a) => a.id === selectedId) ?? null;

  function resetSelectionState() {
    setSelectedCaption(-1);
    setCurrentTime(0);
    setStart(0);
    setEnd(0);
    setDuration(0);
    setCrop("original");
    setFitBackground(false);
    setPan({ x: 50, y: 50 });
    setPlaying(false);
  }

  function handleFile(file: File) {
    const validationError = validateUpload(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    setUploadError(null);
    const asset: UploadedAsset = {
      id: makeId("asset"),
      fileName: file.name,
      objectUrl: URL.createObjectURL(file),
      durationSeconds: null,
      addedAt: new Date().toISOString(),
    };
    resetSelectionState();
    setAssets(addUploadedAsset(asset));
    setSelectedId(asset.id);
  }

  function selectAsset(id: string) {
    resetSelectionState();
    setSelectedId(id);
  }

  function handleRemove(id: string) {
    const asset = assets.find((a) => a.id === id);
    if (asset) URL.revokeObjectURL(asset.objectUrl);
    const next = removeUploadedAsset(id);
    setAssets(next);
    if (selectedId === id) {
      resetSelectionState();
      setSelectedId(next[0]?.id ?? null);
    }
  }

  function handleLoadedMetadata() {
    const videoDuration = videoRef.current?.duration ?? 0;
    setFrame({ width: videoRef.current?.videoWidth ?? 0, height: videoRef.current?.videoHeight ?? 0 });
    setDuration(videoDuration);
    setEnd(videoDuration);
    if (selectedAsset && selectedAsset.durationSeconds === null) {
      updateUploadedAsset(selectedAsset.id, { durationSeconds: videoDuration });
    }
  }

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (video.currentTime >= end) {
      video.pause();
      setPlaying(false);
    }
  }, [end]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.pause();
      setPlaying(false);
    } else {
      if (video.currentTime < start || video.currentTime >= end) video.currentTime = start;
      void video.play();
      setPlaying(true);
    }
  }

  function previewFromStart() {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = start;
    void video.play();
    setPlaying(true);
  }

  function handleScrub(time: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = time;
    setCurrentTime(time);
  }

  useEffect(() => {
    if (!renderId || !exportBusy) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/exports?id=${renderId}`, { cache: 'no-store' });
        const data = await response.json();
        if (stopped) return;
        if (!response.ok) throw new Error(data.message || 'Could not check export.');
        const message = data.status === 'rendering' ? `${data.message} (${Math.round(data.progress)}%)` : data.message;
        setExportMessage(message);
        updateExportJob(renderId!, { status: data.status, progress: data.progress, statusMessage: message });
        if (['complete', 'failed', 'cancelled'].includes(data.status)) { setExportBusy(false); setExportComplete(data.status === 'complete'); return; }
      } catch (error) { if (!stopped) setExportMessage(error instanceof Error ? error.message : 'Reconnecting to renderer...'); }
      if (!stopped) timer = setTimeout(poll, 1500);
    }
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [renderId, exportBusy]);

  async function handleExport() {
    if (!selectedAsset || exportBusy) return;
    const captionError = validateCues(track.cues, duration);
    if (captionError) { setExportMessage(captionError); return; }
    setExportBusy(true); setExportComplete(false); setRenderId(null); setExportMessage('Preparing export...');
    const controller = new AbortController(); exportController.current = controller;
    let id: string | null = null;
    try {
      const source = await fetch(selectedAsset.objectUrl, { signal: controller.signal });
      const video = await source.blob();
      const required = new Set(track.cues.map(cue => resolveCaptionDesign(cue, track.design).preset));
      const fonts = await Promise.all([...exportFonts.current].filter(([preset]) => required.has(preset)).map(async ([preset, file]) => ({ preset, data: await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Could not read font file.')); reader.readAsDataURL(file); }) })));
      const response = await fetch('/api/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, body: JSON.stringify({ spec: { fileName: selectedAsset.fileName, mimeType: video.type, start, end, crop, fitBackground, pan, cues: track.cues, design: track.design, quality: exportQuality }, fonts }) });
      const created = await response.json();
      if (!response.ok) throw new Error(created.message || 'Could not start export.');
      id = created.id; setRenderId(created.id);
      const job: ExportJob = { id: created.id, renderId: created.id, assetId: selectedAsset.id, assetName: selectedAsset.fileName, selection: { assetId: selectedAsset.id, startSeconds: start, endSeconds: end, crop }, status: 'uploading', statusMessage: 'Uploading source video', createdAt: new Date().toISOString() };
      addExportJob(job); setExportMessage('Uploading source video...');
      const upload = await fetch(`/api/exports?id=${created.id}`, { method: 'PUT', headers: { 'Content-Type': video.type }, body: video, signal: controller.signal });
      const result = await upload.json();
      if (!upload.ok) throw new Error(result.message || 'Video upload failed.');
      setExportMessage(exportQuality === 'lossless' ? 'Rendering lossless MP4...' : 'Rendering MP4...');
    } catch (error) {
      if (id) await fetch(`/api/exports?id=${id}`, { method: 'DELETE' }).catch(() => {});
      const message = controller.signal.aborted ? 'Export cancelled.' : error instanceof Error ? error.message : 'Export failed.';
      setExportBusy(false); setExportMessage(message);
      if (id) updateExportJob(id, { status: controller.signal.aborted ? 'cancelled' : 'failed', statusMessage: message });
    }
  }
  async function cancelExport() {
    exportController.current?.abort();
    if (renderId) {
      await fetch(`/api/exports?id=${renderId}`, { method: 'DELETE' });
      updateExportJob(renderId, { status: 'cancelled', statusMessage: 'Export cancelled.' });
    }
    setExportBusy(false); setExportMessage('Export cancelled.');
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
      <h1 className="font-display text-xl font-medium text-text">Studio</h1>
      <p className="mt-1 text-sm text-text-muted">
        Trim, crop, and caption footage you have the rights to use. Uploads are previewed on this device for the current
        browser session.
      </p>

      {assets.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {assets.map((asset) => (
            <div key={asset.id} className="flex items-center">
              <button
                type="button"
                onClick={() => selectAsset(asset.id)}
                className={`max-w-[12rem] truncate rounded-l-md border border-r-0 px-3 py-1.5 text-xs ${
                  asset.id === selectedId
                    ? "border-accent/50 bg-accent-soft text-accent-strong"
                    : "border-border-strong text-text-muted hover:bg-surface-hover"
                }`}
              >
                {asset.fileName}
              </button>
              <button
                type="button"
                onClick={() => handleRemove(asset.id)}
                aria-label={`Remove ${asset.fileName}`}
                className={`rounded-r-md border px-2 py-1.5 text-xs ${
                  asset.id === selectedId
                    ? "border-accent/50 bg-accent-soft text-accent-strong"
                    : "border-border-strong text-text-muted hover:bg-surface-hover"
                }`}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <details open={assets.length === 0}>
          <summary className="flex cursor-pointer items-center gap-1.5 text-xs text-text-faint hover:text-text-muted">
            <UploadCloud size={13} /> {assets.length === 0 ? "Upload footage to begin" : "Add another file"}
          </summary>
          <div className="mt-3">
            <Uploader onFile={handleFile} error={uploadError} />
          </div>
        </details>
      </div>

      {selectedAsset && (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-4">
            <PreviewStage
              frame={frame}
              objectUrl={selectedAsset.objectUrl}
              crop={crop}
              fitBackground={fitBackground}
              pan={pan}
              onPanChange={setPan}
              videoRef={videoRef}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              overlay={<CaptionOverlay cues={track.cues} design={track.design} time={currentTime} onSelect={index => { videoRef.current?.pause(); setPlaying(false); setSelectedCaption(index); }} onDesign={updateCaptionDesign} />}
            />

            <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <Button variant="secondary" size="sm" icon={playing ? <Pause size={14} /> : <Play size={14} />} onClick={togglePlay}>
                {playing ? "Pause" : "Play"}
              </Button>
              <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={previewFromStart}>
                Preview selection
              </Button>
              <span className="ml-auto font-mono text-xs tabular-nums text-text-faint">
                {formatTimecode(currentTime)} / {formatTimecode(duration)}
              </span>
            </div>

            <CaptionTimeline selected={selectedCaption} onSelect={setSelectedCaption} key={selectedAsset.id} cues={track.cues} duration={duration} time={currentTime} onChange={cues => updateTrack({ cues })} onSeek={handleScrub} onPause={() => { videoRef.current?.pause(); setPlaying(false); }} />
            <details className="rounded-lg border border-border bg-surface p-4">
              <summary className="mb-3 cursor-pointer text-xs text-text-muted">Video export range</summary>
              <TrimControls
                duration={duration}
                start={start}
                end={end}
                currentTime={currentTime}
                onChange={(s, e) => {
                  setStart(s);
                  setEnd(e);
                }}
                onScrub={handleScrub}
              />
            </details>

            <div className="rounded-lg border border-border bg-surface p-4">
              <CropModeSelector
                crop={crop}
                onCropChange={setCrop}
                fitBackground={fitBackground}
                onFitBackgroundChange={setFitBackground}
              />
            </div>
          </div>

          <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto">
            <CaptionEditor onFontLoaded={(preset, file) => exportFonts.current.set(preset, file)} selectedCaption={track.cues[selectedCaption] ? selectedCaption : -1} baseDesign={track.design} currentTime={currentTime} key={selectedAsset.id} objectUrl={selectedAsset.objectUrl} fileName={selectedAsset.fileName} duration={duration} start={start} end={end} crop={crop} frame={frame} cues={track.cues} design={editorDesign} onCues={cues => { updateTrack({ cues }); setSelectedCaption(-1); }} onDesign={design => updateCaptionDesign(selectedCaption, design)} onSeek={handleScrub} />
            <ExportSettingsPanel start={start} end={end} crop={crop} quality={exportQuality} onQuality={setExportQuality} onExport={handleExport} busy={exportBusy} message={exportMessage} renderId={renderId} complete={exportComplete} onCancel={cancelExport} />
          </div>
        </div>
      )}
    </div>
  );
}
