import { defineConfig } from "vite";

// The playable app lives in app/. Tooling and content sit outside the bundle root so a
// build never accidentally ships review scripts or raw authoring files.
export default defineConfig({
  root: "app",
  base: "./",
  publicDir: "../public",
  server: { host: "127.0.0.1" },
  build: {
    target: "es2022",
    outDir: "../dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 3000,
  },
});
