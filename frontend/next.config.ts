import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
