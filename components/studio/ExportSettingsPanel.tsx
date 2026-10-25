"use client";

import { Download } from "lucide-react";
import Link from 'next/link';
import { Button } from "@/components/ui/Button";
import { formatTimecode } from "@/lib/format";
import type { CropMode } from "@/lib/types";

export type ExportQuality = 'compatible' | 'lossless';
interface Props { start: number; end: number; crop: CropMode; quality: ExportQuality; onQuality: (quality: ExportQuality) => void; onExport: () => void; busy: boolean; message: string; renderId: string | null; complete: boolean; onCancel: () => void }
export function ExportSettingsPanel({ start, end, crop, quality, onQuality, onExport, busy, message, renderId, complete, onCancel }: Props) {
  const duration = Math.max(0, end - start);
  return <div className="rounded-lg border border-border bg-surface p-4">
    <h3 className="text-sm font-medium text-text">Export MP4</h3>
    <dl className="mt-3 space-y-2 text-xs text-text-muted">
      <div className="flex justify-between"><dt>Duration</dt><dd>{formatTimecode(duration)}</dd></div>
      <div className="flex justify-between"><dt>Crop</dt><dd>{crop}</dd></div>
      <div className="flex justify-between"><dt>Video</dt><dd>{quality === 'lossless' ? 'Lossless H.264' : 'H.264 High, CRF 17'}</dd></div>
      <div className="flex justify-between"><dt>Audio</dt><dd>{quality === 'lossless' ? 'Original / lossless ALAC' : 'Original AAC / high-bitrate AAC'}</dd></div>
    </dl>
    <fieldset className="mt-3" disabled={busy}>
      <legend className="mb-1.5 text-xs text-text-muted">Quality</legend>
      <div className="grid grid-cols-2 gap-1.5">
        {([['compatible', 'Compatible', 'Plays everywhere'], ['lossless', 'Lossless', 'Master for editing']] as const).map(([value, label, hint]) => (
          <button key={value} type="button" aria-pressed={quality === value} onClick={() => onQuality(value)}
            className={`rounded-md border px-2 py-1.5 text-left text-xs ${quality === value ? 'border-accent bg-accent-soft text-text' : 'border-border-strong text-text-muted hover:bg-surface-hover'}`}>
            <span className="block font-medium">{label}</span><span className="block text-[11px] text-text-muted">{hint}</span>
          </button>
        ))}
      </div>
    </fieldset>
    <p className="mt-3 text-xs leading-relaxed text-text-muted">Keeps source resolution and frame timing; never upscales. Cropping only changes the selected framing.{quality === 'lossless'
      ? ' Full-length compatible audio is copied; trimmed audio uses lossless ALAC without resampling or downmixing.'
      : ' Visually transparent H.264 and AAC that play in browsers, on phones, and on Instagram, YouTube and TikTok.'}</p>
    <p className="mt-2 text-xs leading-relaxed text-text-muted">{quality === 'lossless' ? "Lossless files are very large and won't play in browsers or upload to most social apps; use them as editing masters. " : ''}Caption backgrounds render as rectangular boxes. Export uploads your video and loaded fonts to this server.</p>
    <Button variant="primary" size="sm" className="mt-4 w-full" icon={<Download size={14} />} onClick={onExport} disabled={busy || duration <= 0}>{busy ? 'Exporting...' : quality === 'lossless' ? 'Export lossless MP4' : 'Export MP4'}</Button>
    {busy && <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={onCancel}>Cancel export</Button>}
    {message && <p role="status" className="mt-3 text-xs text-text-muted">{message}</p>}
    {complete && renderId && <a className="mt-3 block text-sm text-accent-strong underline" href={`/api/exports?id=${renderId}&file=1`} download>Download MP4</a>}
    <Link href="/exports" className="mt-3 block text-xs text-accent-strong hover:underline">View exports</Link>
  </div>;
}
