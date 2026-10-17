import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.BODYCAST_FULLSITE_PREVIEW === "1" ? ".next-fullsite-preview" : ".next",
  async headers() {
    return [{
      source: "/body-map/bodyparts3d-v3/:asset(.*\\.glb)",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
};

export default nextConfig;
