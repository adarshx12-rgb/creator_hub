"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB local preview ceiling

interface UploaderProps {
  onFile: (file: File) => void;
  error: string | null;
}

export function Uploader({ onFile, error }: UploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    onFile(file);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-16 text-center transition-colors ${
          dragOver ? "border-accent bg-accent-soft" : "border-border-strong bg-surface hover:bg-surface-hover"
        }`}
      >
        <UploadCloud size={26} className="text-text-faint" />
        <div>
          <p className="text-sm text-text">Drop a video file, or click to browse</p>
          <p className="mt-1 text-xs text-text-faint">MP4, MOV, or WebM - authorized footage only, up to 2GB</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

export function validateUpload(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "Unsupported file type. Upload an MP4, MOV, or WebM file.";
  }
  if (file.size > MAX_BYTES) {
    return "File is larger than the 2GB local preview limit.";
  }
  return null;
}
