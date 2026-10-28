import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Orb's Python server (uv run orb) stays on 127.0.0.1:8765. In development Vite serves the page and
// passes the WebSocket and the server's own files through; start the server with
// ORB_DEV_ORIGIN=http://localhost:5173 so its same-origin check accepts this page.
const server = `127.0.0.1:${process.env.ORB_PORT ?? "8765"}`;

export default defineConfig({
  plugins: [react()],
  base: "/static/app/", // where FastAPI serves the build
  build: {
    outDir: "../src/orb/static/app", // committed: `uv tool install` never needs Node
    emptyOutDir: true,
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/ws": { target: `ws://${server}`, ws: true }, // origin passes through as-is (no rewriteWsOrigin)
      "/api": `http://${server}`,
      "/static/vendor": `http://${server}`,
      "/static/icons": `http://${server}`,
      "/manifest.webmanifest": `http://${server}`,
    },
  },
});
