import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (mode === "android") {
    const apiUrl = env.VITE_CAPACITOR_API_URL;
    if (!apiUrl || !/^https:\/\//i.test(apiUrl) || !new URL(apiUrl).pathname.replace(/\/$/, "").endsWith("/api")) {
      throw new Error("Android build requires VITE_CAPACITOR_API_URL pointing to the HTTPS production/staging BFF ending in /api.");
    }
  }
  return {
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3000",
          changeOrigin: false,
        },
      },
    },
  };
});
