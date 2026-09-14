import { SearchConsole } from "@/components/search/SearchConsole";
import { getPopularYoutubeVideos } from "@/lib/youtube";

export default async function HomePage() {
  return <SearchConsole popular={await getPopularYoutubeVideos()} />;
}
