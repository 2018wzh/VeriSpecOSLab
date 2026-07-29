import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VOS_PORTAL_");
  const demo = mode === "demo";
  if (!demo && env.VOS_PORTAL_DEMO === "1") throw new Error("Production build refuses VOS_PORTAL_DEMO");
  return {
    plugins: [react()],
    define: { __VOS_PORTAL_DEMO__: JSON.stringify(demo) },
    build: { outDir: demo ? "dist-demo" : "dist", sourcemap: true },
    server: { proxy: demo ? undefined : { "/api": "http://127.0.0.1:8787" } },
  };
});
