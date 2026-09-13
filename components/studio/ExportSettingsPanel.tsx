"use client";

import { motion } from "motion/react";
import { CircleAlert, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatTimecode } from "@/lib/format";
import type { CropMode } from "@/lib/types";

interface ExportSettingsPanelProps {
  start: number;
  end: number;
  crop: CropMode;
  onExport: () => void;
  justQueued: boolean;
}

export function ExportSettingsPanel({ start, end, crop, onExport, justQueued }: ExportSettingsPanelProps) {
  const duration = Math.max(0, end - start);
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-medium text-text">Export settings</h3>
      <dl className="mt-3 space-y-1.5 text-xs text-text-muted">
        <div className="flex justify-between">
          <dt>Selected duration</dt>
          <dd className="font-mono tabular-nums text-text">{formatTimecode(duration)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Crop</dt>
          <dd className="text-text">{crop}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Format</dt>
          <dd className="text-text">MP4 (H.264 / AAC)</dd>
        </div>
      </dl>
      <Button
        variant="primary"
        size="sm"
        className="mt-4 w-full"
        icon={<Download size={14} />}
        onClick={onExport}
        disabled={duration <= 0}
      >
        Export clip
      </Button>
      {justQueued && (
        <motion.p
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-text-muted"
        >
          <CircleAlert size={13} className="mt-0.5 shrink-0 text-accent" />
          Saved to Exports. The processing worker isn&apos;t connected in this build, so rendering is on
          hold until it is.
        </motion.p>
      )}
    </div>
  );
}
