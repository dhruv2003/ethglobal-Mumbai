import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const here = path.dirname(fileURLToPath(import.meta.url));

// Demo build: no backend, no chain, no wallet. Every read comes from src/data/*.json.
export default defineConfig({
  resolve: {
    alias: {
      "@ds": path.resolve(here, "design-system"),
      "@contracts": path.resolve(here, "src/contracts"),
      "@data": path.resolve(here, "src/data"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: { port: 5190 },
  preview: { port: 5190 },
  plugins: [react()],
  test: { environment: "node" },
});
