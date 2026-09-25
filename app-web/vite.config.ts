import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

// Live mode: the app calls /v4/* on its own origin and the dev server forwards it to the backend (npm run api).
// The backend's APP_SECRET is added HERE, server-side, from the repo's .env (no VITE_ prefix = never in the bundle),
// so the app can create the card and answer asks while the secret never reaches the browser.
export default defineConfig(({ mode }) => {
    const repoEnv = loadEnv(mode, path.resolve(__dirname, ".."), "");
    const appEnv = loadEnv(mode, __dirname, "");
    const target = appEnv.API_TARGET || repoEnv.API_TARGET || `http://localhost:${repoEnv.PORT || 8787}`;
    const secret = appEnv.APP_SECRET || repoEnv.APP_SECRET || "";

    return {
        plugins: [react(), tailwindcss()],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
        server: {
            proxy: {
                "/v4": {
                    target,
                    changeOrigin: true,
                    configure: (proxy) => {
                        proxy.on("proxyReq", (req) => {
                            if (secret) req.setHeader("Authorization", `Bearer ${secret}`);
                        });
                    },
                },
            },
        },
    };
});
