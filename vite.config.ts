import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1430,
    strictPort: true,
    // Bind IPv4 explicitly — WebView2 on Windows can fail to load plain "localhost" (::1).
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : {
          host: "127.0.0.1",
        },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
