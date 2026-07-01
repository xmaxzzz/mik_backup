import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The built SPA is served by the FastAPI backend from app/static.
// During dev, /api is proxied to the backend on :8000.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
