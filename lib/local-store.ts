import {
  EXPORT_JOBS_KEY,
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  SAVED_MOMENTS_KEY,
  UPLOADED_ASSETS_KEY,
} from "./constants";
import type { ExportJob, RecentSearch, SavedMoment, UploadedAsset } from "./types";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable (private mode, quota) - fail silently, data stays session-only.
  }
}

export function getRecentSearches(): RecentSearch[] {
  return read<RecentSearch[]>(RECENT_SEARCHES_KEY, []);
}

export function addRecentSearch(query: string): RecentSearch[] {
  const trimmed = query.trim();
  if (!trimmed) return getRecentSearches();
  const existing = getRecentSearches().filter((entry) => entry.query.toLowerCase() !== trimmed.toLowerCase());
  const next = [{ query: trimmed, at: new Date().toISOString() }, ...existing].slice(0, MAX_RECENT_SEARCHES);
  write(RECENT_SEARCHES_KEY, next);
  return next;
}

export function clearRecentSearches(): RecentSearch[] {
  write(RECENT_SEARCHES_KEY, []);
  return [];
}

export function getSavedMoments(): SavedMoment[] {
  return read<SavedMoment[]>(SAVED_MOMENTS_KEY, []);
}

export function addSavedMoment(moment: SavedMoment): SavedMoment[] {
  const next = [moment, ...getSavedMoments()];
  write(SAVED_MOMENTS_KEY, next);
  return next;
}

export function removeSavedMoment(id: string): SavedMoment[] {
  const next = getSavedMoments().filter((moment) => moment.id !== id);
  write(SAVED_MOMENTS_KEY, next);
  return next;
}

export function updateSavedMoment(id: string, patch: Partial<SavedMoment>): SavedMoment[] {
  const next = getSavedMoments().map((moment) => (moment.id === id ? { ...moment, ...patch } : moment));
  write(SAVED_MOMENTS_KEY, next);
  return next;
}

export function getUploadedAssets(): UploadedAsset[] {
  return read<UploadedAsset[]>(UPLOADED_ASSETS_KEY, []);
}

export function addUploadedAsset(asset: UploadedAsset): UploadedAsset[] {
  const next = [asset, ...getUploadedAssets()];
  write(UPLOADED_ASSETS_KEY, next);
  return next;
}

export function removeUploadedAsset(id: string): UploadedAsset[] {
  const next = getUploadedAssets().filter((asset) => asset.id !== id);
  write(UPLOADED_ASSETS_KEY, next);
  return next;
}

export function updateUploadedAsset(id: string, patch: Partial<UploadedAsset>): UploadedAsset[] {
  const next = getUploadedAssets().map((asset) => (asset.id === id ? { ...asset, ...patch } : asset));
  write(UPLOADED_ASSETS_KEY, next);
  return next;
}

export function getExportJobs(): ExportJob[] {
  return read<ExportJob[]>(EXPORT_JOBS_KEY, []);
}

export function addExportJob(job: ExportJob): ExportJob[] {
  const next = [job, ...getExportJobs()];
  write(EXPORT_JOBS_KEY, next);
  return next;
}

export function removeExportJob(id: string): ExportJob[] {
  const next = getExportJobs().filter((job) => job.id !== id);
  write(EXPORT_JOBS_KEY, next);
  return next;
}
