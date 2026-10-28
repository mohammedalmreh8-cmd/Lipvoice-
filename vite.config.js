import { defineConfig } from "vite";
import { resolve } from "node:path";

async function serveArabicTts(req, res) {
  try {
    const raw = String(req.url || "");
    const url = new URL(raw.startsWith("http") ? raw : "http://localhost" + (raw.startsWith("/") ? raw : "/" + raw));
    const text = String(url.searchParams.get("q") || "").trim().slice(0, 180);
    if (!text) {
      res.statusCode = 400;
      res.end("missing q");
      return;
    }
    const upstream = await fetch(
      "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=ar&q=" + encodeURIComponent(text),
      { headers: { "User-Agent": "Mozilla/5.0 LipVoice/1.0" } }
    );
    if (!upstream.ok) {
      res.statusCode = upstream.status;
      res.end("tts-fail");
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(buf);
  } catch {
    res.statusCode = 502;
    res.end("tts-fail");
  }
}

function arabicTtsPlugin() {
  return {
    name: "arabic-tts",
    configureServer(server) {
      server.middlewares.use("/api/ar-tts", serveArabicTts);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/api/ar-tts", serveArabicTts);
    },
  };
}

export default defineConfig({
  plugins: [arabicTtsPlugin()],
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
