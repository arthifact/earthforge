import { defineConfig } from "vite";

// Port 5174, so it can run next to Seismic Glade (5173).
export default defineConfig({ server: { port: 5174, strictPort: true } });
