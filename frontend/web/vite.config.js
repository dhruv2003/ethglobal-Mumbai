import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const here = path.dirname(fileURLToPath(import.meta.url));
// The design system is the single source of truth: import it, don't copy it.
const designSystem = path.resolve(here, "../design-system/src");
// Sample projects shown on /projects (small JSON files only).
const fixtures = path.resolve(here, "../../backend/fixtures");
// Contract ABIs (JSON only).
const contracts = path.resolve(here, "../../backend/contracts");

export default defineConfig({
  resolve: {
    alias: { "@ds": designSystem, "@fixtures": fixtures, "@contracts": contracts },
    // ui.jsx lives outside this app; make its react imports resolve to ours.
    dedupe: ["react", "react-dom"],
  },
  // The backend (backend/src/server.js) serves /api on port 3000.
  // xfwd marks proxied requests, so the backend never mistakes a visitor for a local operator.
  server: { fs: { allow: [path.resolve(here, ".."), fixtures, contracts] }, proxy: { "/api": { target: "http://localhost:3000", xfwd: true } } },
  preview: { proxy: { "/api": { target: "http://localhost:3000", xfwd: true } } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon.svg"],
      manifest: {
        name: "Battle Arena",
        short_name: "Arena",
        description: "Submit your hackathon project and turn it into an AI fighter.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#fffdf8",
        theme_color: "#fffdf8",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Smoke-test posters and videos are large and only needed on one page: stream, don't precache.
        globIgnores: ["**/assets/smoke-*", "**/assets/video-*"],
        // Never answer /api from the offline app shell.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  test: { environment: "node" },
});
