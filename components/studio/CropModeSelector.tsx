"use client";

import { Chip } from "@/components/ui/Chip";
import type { CropMode } from "@/lib/types";

const MODES: { value: CropMode; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
];

interface CropModeSelectorProps {
  crop: CropMode;
  onCropChange: (crop: CropMode) => void;
  fitBackground: boolean;
  onFitBackgroundChange: (value: boolean) => void;
}

export function CropModeSelector({ crop, onCropChange, fitBackground, onFitBackgroundChange }: CropModeSelectorProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        {MODES.map((mode) => (
          <Chip key={mode.value} active={crop === mode.value} onClick={() => onCropChange(mode.value)}>
            {mode.label}
          </Chip>
        ))}
      </div>
      {crop !== "original" && (
        <label className="flex items-center gap-2 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={fitBackground}
            onChange={(e) => onFitBackgroundChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-strong accent-[var(--color-accent)]"
          />
          Fit whole frame instead of cropping
        </label>
      )}
    </div>
  );
}
