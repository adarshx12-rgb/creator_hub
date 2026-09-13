export function parseIso8601Duration(input: string): number | null {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(input);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  const total =
    (Number(days ?? 0) * 24 + Number(hours ?? 0)) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Number.isFinite(total) ? total : null;
}

export function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || !Number.isFinite(totalSeconds)) return "--:--";
  const seconds = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatViews(count: number | null): string {
  if (count === null) return "views unavailable";
  if (count < 1000) return `${count} views`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}K views`;
  if (count < 1_000_000_000) return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M views`;
  return `${(count / 1_000_000_000).toFixed(1)}B views`;
}

export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown date";
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const divisions: [number, string][] = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
    [4.345, "week"],
    [12, "month"],
    [Number.POSITIVE_INFINITY, "year"],
  ];
  let unit = "second";
  let value = diffSec;
  for (const [amount, name] of divisions) {
    if (Math.abs(value) < amount) {
      unit = name;
      break;
    }
    value = Math.round(value / amount);
    unit = name;
  }
  if (value <= 0) return "just now";
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function formatTimecode(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = h > 0 ? [h, m, s] : [m, s];
  return parts.map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, "0"))).join(":");
}
