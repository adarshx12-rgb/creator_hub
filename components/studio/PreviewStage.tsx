"use client";

import { useEffect, useRef } from "react";
import { motion, type PanInfo } from "motion/react";
import { Move } from "lucide-react";
import type { CropMode } from "@/lib/types";

interface PreviewStageProps {
  overlay?: React.ReactNode;
  /** Source pixel size; in original mode the frame follows it so captions line up with the picture. */
  frame?: { width: number; height: number };
  objectUrl: string;
  crop: CropMode;
  fitBackground: boolean;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onLoadedMetadata: () => void;
  onTimeUpdate: () => void;
}

const ASPECT: Record<CropMode, string> = {
  original: "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function PreviewStage({
  overlay,
  frame,
  objectUrl,
  crop,
  fitBackground,
  pan,
  onPanChange,
  videoRef,
  onLoadedMetadata,
  onTimeUpdate,
}: PreviewStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Read the media clock every rendered frame instead of waiting for timeupdate.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let frameId = 0;
    const tick = () => {
      onTimeUpdate();
      if (!video.paused && !video.ended) frameId = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(frameId); tick(); };
    const stop = () => { cancelAnimationFrame(frameId); onTimeUpdate(); };
    video.addEventListener('play', start);
    video.addEventListener('pause', stop);
    video.addEventListener('seeked', start);
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(frameId);
      video.removeEventListener('play', start);
      video.removeEventListener('pause', stop);
      video.removeEventListener('seeked', start);
    };
  }, [videoRef, onTimeUpdate, objectUrl]);
  const canPan = crop !== "original" && !fitBackground;
  const knownFrame = crop === "original" && frame && frame.width > 0 && frame.height > 0 ? frame : null;
  const aspect = knownFrame ? `${knownFrame.width} / ${knownFrame.height}` : ASPECT[crop];
  const shape = knownFrame ? (knownFrame.height > knownFrame.width ? "9:16" : knownFrame.height === knownFrame.width ? "1:1" : "original") : crop;

  function handlePan(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onPanChange({
      x: clamp(pan.x + (info.delta.x / rect.width) * 100, 0, 100),
      y: clamp(pan.y + (info.delta.y / rect.height) * 100, 0, 100),
    });
  }

  return (
    <div className="flex justify-center rounded-lg border border-border bg-surface p-4">
      <motion.div
        ref={containerRef}
        onPan={canPan ? handlePan : undefined}
        layout
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className={`relative max-h-[60vh] w-full overflow-hidden rounded-md bg-black ${
          shape === "9:16" ? "mx-auto max-w-[280px]" : shape === "1:1" ? "mx-auto max-w-md" : ""
        } ${canPan ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{ aspectRatio: aspect }}
      >
        <video
          ref={videoRef}
          src={objectUrl}
          onLoadedMetadata={onLoadedMetadata}
          onTimeUpdate={onTimeUpdate}
          className="h-full w-full"
          style={{
            objectFit: fitBackground || crop === "original" ? "contain" : "cover",
            objectPosition: canPan ? `${pan.x}% ${pan.y}%` : "50% 50%",
          }}
          playsInline
        />
        {overlay}
        {canPan && (
          <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-1 text-[0.65rem] text-white/80">
            <Move size={11} /> Drag to reposition
          </div>
        )}
      </motion.div>
    </div>
  );
}
