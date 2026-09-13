"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Trash2, UploadCloud } from "lucide-react";
import { Uploader, validateUpload } from "./Uploader";
import { PreviewStage } from "./PreviewStage";
import { TrimControls } from "./TrimControls";
import { CropModeSelector } from "./CropModeSelector";
import { ExportSettingsPanel } from "./ExportSettingsPanel";
import { Button } from "@/components/ui/Button";
import { formatTimecode } from "@/lib/format";
import {
  addExportJob,
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
  const [justQueued, setJustQueued] = useState(false);

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
    setDuration(videoDuration);
    setEnd(videoDuration);
    if (selectedAsset && selectedAsset.durationSeconds === null) {
      updateUploadedAsset(selectedAsset.id, { durationSeconds: videoDuration });
    }
  }

  function handleTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentTime(video.currentTime);
    if (video.currentTime >= end) {
      video.pause();
      setPlaying(false);
    }
  }

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

  function handleExport() {
    if (!selectedAsset) return;
    const job: ExportJob = {
      id: makeId("job"),
      assetId: selectedAsset.id,
      assetName: selectedAsset.fileName,
      selection: { assetId: selectedAsset.id, startSeconds: start, endSeconds: end, crop },
      status: "blocked",
      statusMessage: "Processing worker isn't connected in this build.",
      createdAt: new Date().toISOString(),
    };
    addExportJob(job);
    setJustQueued(true);
    setTimeout(() => setJustQueued(false), 5000);
  }

  if (!loaded) return null;

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <h1 className="font-display text-xl font-medium text-text">Studio</h1>
      <p className="mt-1 text-sm text-text-muted">
        Trim and crop footage you have the rights to use. Uploads stay on this device for the current
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
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <PreviewStage
              objectUrl={selectedAsset.objectUrl}
              crop={crop}
              fitBackground={fitBackground}
              pan={pan}
              onPanChange={setPan}
              videoRef={videoRef}
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
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

            <div className="rounded-lg border border-border bg-surface p-4">
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
            </div>

            <div className="rounded-lg border border-border bg-surface p-4">
              <CropModeSelector
                crop={crop}
                onCropChange={setCrop}
                fitBackground={fitBackground}
                onFitBackgroundChange={setFitBackground}
              />
            </div>
          </div>

          <div className="space-y-4">
            <ExportSettingsPanel start={start} end={end} crop={crop} onExport={handleExport} justQueued={justQueued} />
          </div>
        </div>
      )}
    </div>
  );
}
