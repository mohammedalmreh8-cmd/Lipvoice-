import { synthesizePhrase } from "./clone.js";
import { validateSpeech, samplesToBuffer } from "./audio.js";
import { getTTSSettings } from "./voices.js";

function base64ToArrayBuffer(b64) {
  const clean = String(b64).replace(/^data:[^,]*,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function remoteReady(cfg) {
  return !!(cfg && cfg.enabled && cfg.url && cfg.url.trim());
}

function validateAudioBuffer(audio) {
  if (!audio || !audio.length || !audio.sampleRate) return { ok: false };
  const seconds = audio.length / audio.sampleRate;
  if (seconds < 0.1) return { ok: false };
  const data = audio.getChannelData(0);
  let peak = 0, sq = 0;
  for (let i = 0; i < data.length; i += 2) {
    const a = Math.abs(data[i]);
    if (a > peak) peak = a;
    sq += data[i] * data[i];
  }
  const rms = Math.sqrt(sq / Math.ceil(data.length / 2));
  if (peak < 0.02 || rms < 0.003) return { ok: false };
  return { ok: true };
}

async function fetchRemote(text, lang, cfg, ctx) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(4000, Number(cfg.timeout) || 15000));
  try {
    const res = await fetch(cfg.url.trim(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {}),
        ...(cfg.headerName && cfg.headerValue ? { [cfg.headerName]: cfg.headerValue } : {}),
      },
      body: JSON.stringify({
        text,
        language: lang,
        voice: cfg.voice || undefined,
        reference: cfg.voiceRef || undefined,
        format: "wav",
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`remote-http-${res.status}`);
    const type = res.headers.get("content-type") || "";
    let buf;
    if (type.includes("application/json") || type.includes("text/json")) {
      const data = await res.json();
      const b64 = data.audio || data.audio_base64 || data.data;
      if (!b64) throw new Error("remote-empty");
      buf = base64ToArrayBuffer(b64);
    } else {
      buf = await res.arrayBuffer();
    }
    if (!buf || !buf.byteLength) throw new Error("remote-empty");
    return await ctx.decodeAudioData(buf.slice(0));
  } finally {
    clearTimeout(timeout);
  }
}

// Generate speech for a phrase. When a remote cloning endpoint is explicitly
// enabled it is used and its failures are reported (never silently substituted).
// Otherwise the on-device reference-conditioned synthesizer is used.
export async function generateSpeech({ text, lang, ctx, donor, allowRemote = true }) {
  if (!text) throw new Error("no-text");
  const cfg = getTTSSettings();
  if (allowRemote && remoteReady(cfg)) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const audio = await fetchRemote(text, lang, cfg, ctx);
        const v = validateAudioBuffer(audio);
        if (!v.ok) throw new Error("remote-invalid");
        return {
          buffer: audio,
          provider: "remote",
          diag: {
            engine: "remote-neural",
            format: "decoded-audio",
            sampleRate: audio.sampleRate,
            channels: audio.numberOfChannels || 1,
            duration: audio.duration,
            text,
          },
        };
      } catch (err) {
        lastError = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
    }
    const e = new Error("remote-fail");
    e.cause = lastError;
    throw e;
  }
  const synth = synthesizePhrase(donor, text, lang, 22050);
  if (!synth) throw new Error("no-text");
  const v = validateSpeech(synth.samples, synth.sr);
  if (!v.ok) throw new Error("synth-" + v.reason);
  return {
    buffer: samplesToBuffer(ctx, synth.samples, synth.sr),
    provider: "ondevice",
    samples: synth.samples,
    sr: synth.sr,
    diag: synth.diag,
  };
}

export async function testRemote(cfg, ctx, text = "Hello, how are you?", lang = "en") {
  if (!remoteReady(cfg)) throw new Error("remote-off");
  const audio = await fetchRemote(text, lang, cfg, ctx);
  const v = validateAudioBuffer(audio);
  if (!v.ok) throw new Error("remote-invalid");
  return audio;
}
