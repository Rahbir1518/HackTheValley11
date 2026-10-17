import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. for automated checks) run beside yours without sharing .next.
  distDir: process.env.ORDIS_DIST_DIR || ".next",
  // The app is almost entirely client-side (3D viewer, live agent stream), so
  // Cache Components / partial prefetching are left off to keep auth simple.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
