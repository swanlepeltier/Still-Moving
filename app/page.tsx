import { getMedia } from "@/lib/videos";
import VideoWall from "@/components/VideoWall";

// The wall is a live mirror of public/media, so scan on each request instead of
// freezing the file list at build time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const media = await getMedia();
  return <VideoWall media={media} />;
}
