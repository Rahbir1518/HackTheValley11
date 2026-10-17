import type { NextConfig } from "next";

// The API is also reachable through this app at /ordis-api/* (proxied to the backend), so one
// tunnel (e.g. ngrok on port 3000) serves both the website and the API to a phone.
const apiProxyTarget = process.env.ORDIS_API_PROXY || "http://localhost:8000";

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. for automated checks) run beside yours without sharing .next.
  distDir: process.env.ORDIS_DIST_DIR || ".next",
  // Tunnel domains allowed to load the dev server (otherwise only localhost is trusted).
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok-free.dev", "*.ngrok.app", "*.ngrok.io", "*.trycloudflare.com"],
  rewrites: async () => [{ source: "/ordis-api/:path*", destination: `${apiProxyTarget}/:path*` }],
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
