import { notFound } from "next/navigation";
import { VideoDetailView } from "@/components/video/VideoDetailView";
import { SetupRequiredPanel } from "@/components/results/StatusPanel";
import { getYoutubeVideo } from "@/lib/youtube";
import { getTwitchClip, getTwitchVideo } from "@/lib/twitch";
import type { Provider } from "@/lib/types";

const PROVIDERS: Provider[] = ["youtube", "twitch"];

export default async function VideoPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string; id: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { provider, id } = await params;
  const { t } = await searchParams;

  if (!PROVIDERS.includes(provider as Provider)) notFound();
  const typedProvider = provider as Provider;

  const configured =
    typedProvider === "youtube" ? Boolean(process.env.YOUTUBE_API_KEY) : Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
  if (!configured) {
    return (
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <SetupRequiredPanel
          message={
            typedProvider === "youtube"
              ? undefined
              : "Add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET to your environment to enable Twitch."
          }
        />
      </div>
    );
  }

  let video;
  try {
    video = typedProvider === "youtube" ? await getYoutubeVideo(id)
      : id.startsWith("vod-") ? await getTwitchVideo(id.slice(4)) : await getTwitchClip(id);
  } catch {
    return (
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <p role="alert" className="text-sm text-text-muted">Could not load this source right now. Refresh the page to try again.</p>
      </div>
    );
  }
  if (!video) notFound();

  const initialSeconds = t ? Number(t) : undefined;

  return <VideoDetailView video={video} initialSeconds={Number.isFinite(initialSeconds) ? initialSeconds : undefined} />;
}
