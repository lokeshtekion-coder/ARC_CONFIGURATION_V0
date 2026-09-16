import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    // Without this, Vite silently falls back to 5176+ if 5175 is already
    // taken (e.g. a stale dev server left running) - and the extension,
    // manifest, and backend CORS list are all hardcoded to 5175, so a
    // silent fallback breaks the token bridge without any obvious error.
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});