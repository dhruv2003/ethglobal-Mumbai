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

export default defineConfig({
  resolve: {
    alias: { "@ds": designSystem, "@fixtures": fixtures },
    // ui.jsx lives outside this app; make its react imports resolve to ours.
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [path.resolve(here, ".."), fixtures] } },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon.svg"],
      manifest: {
        name: "Battle Arena: enter your project",
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
