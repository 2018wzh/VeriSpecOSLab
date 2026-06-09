import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

declare const process: {
  env: Record<string, string | undefined>;
};

const proxyTarget =
  process.env.VOS_AGENT_API_ORIGIN ??
  process.env.VOS_PORTAL_API_ORIGIN ??
  "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": proxyTarget,
      "/v1": proxyTarget
    }
  }
});
