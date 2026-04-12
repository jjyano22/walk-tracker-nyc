import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' https://api.mapbox.com; img-src 'self' data: blob: https://*.mapbox.com; connect-src 'self' https://*.mapbox.com https://*.tiles.mapbox.com; worker-src blob:; font-src 'self' https://api.mapbox.com;",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
