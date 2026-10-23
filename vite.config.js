import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    allowedHosts: [".monkeycode-ai.live"],
  },
  preview: {
    host: true,
    port: 5173,
    allowedHosts: [".monkeycode-ai.live"],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        presentation: resolve(process.cwd(), "presentation.html"),
      },
    },
  },
});
