import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.BODYCAST_FULLSITE_PREVIEW === "1" ? ".next-fullsite-preview" : ".next",
};

export default nextConfig;
