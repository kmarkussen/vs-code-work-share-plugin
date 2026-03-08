import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const proxyTarget = process.env.VITE_PROXY_TARGET ?? "http://localhost:3000";

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "../server/public",
        emptyOutDir: true,
    },
    server: {
        proxy: {
            "/activities": proxyTarget,
            "/patches": proxyTarget,
            "/health": proxyTarget,
        },
    },
});
