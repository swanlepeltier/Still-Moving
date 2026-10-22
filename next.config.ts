import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    const mediaCache = [
      {
        key: "Cache-Control",
        value: "public, max-age=86400, stale-while-revalidate=604800",
      },
    ];

    return [
      { source: "/videos/:path*", headers: mediaCache },
      { source: "/posters/:path*", headers: mediaCache },
    ];
  },
};

export default nextConfig;
