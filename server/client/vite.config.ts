import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "../public",
        emptyOutDir: true,
    },
    server: {
        proxy: {
            "/activities": "http://localhost:3000",
            "/patches": "http://localhost:3000",
            "/health": "http://localhost:3000",
        },
    },
});
