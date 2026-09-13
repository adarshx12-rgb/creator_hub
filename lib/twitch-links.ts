export type TwitchLink = { kind: "video" | "clip" | "channel"; id: string };

export function parseTwitchLink(input: string): TwitchLink | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/$/, "");
    if (host === "clips.twitch.tv" && /^\/[\w-]+$/.test(path)) return { kind: "clip", id: path.slice(1) };
    if (!["twitch.tv", "www.twitch.tv", "m.twitch.tv"].includes(host)) return null;
    const video = /^\/videos\/(\d+)$/.exec(path);
    if (video) return { kind: "video", id: video[1] };
    const clip = /^\/[\w]+\/clip\/([\w-]+)$/.exec(path);
    if (clip) return { kind: "clip", id: clip[1] };
    const channel = /^\/([\w]+)(?:\/videos)?$/.exec(path);
    return channel ? { kind: "channel", id: channel[1] } : null;
  } catch { return null; }
}

export function parseTwitchDuration(value: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value);
  if (!match || !value) return null;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function twitchEmbedUrl(id: string, parent: string, seconds = 0): string {
  const isVideo = id.startsWith("vod-");
  const params = new URLSearchParams({ parent, autoplay: "false" });
  if (isVideo) {
    params.set("video", `v${id.slice(4)}`);
    params.set("time", `${Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))}s`);
  } else { params.set("clip", id); }
  return `${isVideo ? "https://player.twitch.tv/" : "https://clips.twitch.tv/embed"}?${params}`;
}
