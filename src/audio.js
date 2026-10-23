// Audio decode, cleanup, quality analysis and WAV helpers for the voice pipeline.
// Everything runs on-device; nothing is uploaded.

export async function decodeToMono(blob, ctx) {
  if (!blob) throw new Error("bad-file");
  const raw = await blob.arrayBuffer();
  if (!raw || !raw.byteLength) throw new Error("bad-file");
  let audio;
  try {
    audio = await ctx.decodeAudioData(raw.slice(0));
  } catch {
    throw new Error("bad-file");
  }
  const channels = audio.numberOfChannels || 1;
  const len = audio.length;
  if (!len) throw new Error("bad-file");
  const out = new Float32Array(len);
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += data[i];
  }
  if (channels > 1) for (let i = 0; i < len; i++) out[i] /= channels;
  return { samples: out, sampleRate: audio.sampleRate || ctx.sampleRate, channels };
}

function biquad(samples, b0, b1, b2, a0, a1, a2) {
  const out = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < samples.length; i++) {
    const x0 = samples[i];
    const y0 = (b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

export function highpass(samples, sr, fc, q = 0.707) {
  const w0 = (2 * Math.PI * fc) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q);
  return biquad(samples, (1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}

export function lowpass(samples, sr, fc, q = 0.707) {
  const w0 = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
  const cw = Math.cos(w0), sw = Math.sin(w0), alpha = sw / (2 * q);
  return biquad(samples, (1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / (x.length || 1));
}

// Clean a reference recording: de-DC, remove rumble and hiss, gate the silence,
// then bring it to a consistent loudness without clipping. Returns cleaned mono
// samples plus a report used to warn about unsuitable recordings.
export function preprocessReference(samples, sr) {
  const n = samples.length;
  const report = { sampleRate: sr, duration: n / sr };

  let mean = 0, inputPeak = 0, clip = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    mean += v;
    const a = Math.abs(v);
    if (a > inputPeak) inputPeak = a;
    if (a >= 0.985) clip += 1;
  }
  mean /= n || 1;
  report.dcOffset = mean;
  report.inputPeak = inputPeak;
  report.clippingRatio = clip / (n || 1);

  let x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = samples[i] - mean;

  x = highpass(x, sr, 70, 0.707);
  x = lowpass(x, sr, 7800, 0.707);

  const win = Math.max(64, Math.floor(sr * 0.02));
  const hop = Math.max(16, Math.floor(win / 2));
  const energies = [];
  for (let o = 0; o + win <= n; o += hop) {
    let s = 0;
    for (let j = 0; j < win; j++) s += x[o + j] * x[o + j];
    energies.push(Math.sqrt(s / win));
  }
  const lowFloor = percentile(energies, 0.05);
  const speechLevel = percentile(energies, 0.9);
  const speechThresh = Math.max(0.004, speechLevel * 0.22);
  const gateThresh = Math.min(Math.max(lowFloor * 2.2, 0.004), speechLevel * 0.35);

  let active = 0;
  const gains = energies.map((e) => {
    if (e >= speechThresh) active += 1;
    return e >= gateThresh ? 1 : 0.18;
  });
  let g = 1;
  const smooth = new Float32Array(gains.length);
  for (let i = 0; i < gains.length; i++) {
    g += (gains[i] - g) * 0.25;
    smooth[i] = g;
  }
  for (let i = 0; i < n; i++) {
    const idx = Math.min(smooth.length - 1, Math.floor(i / hop));
    x[i] *= smooth[idx] || 1;
  }

  let sq = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    sq += x[i] * x[i];
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  const rawRms = Math.sqrt(sq / (n || 1));
  let gain = rawRms > 1e-6 ? 0.13 / rawRms : 1;
  if (peak * gain > 0.95) gain = 0.95 / peak;
  for (let i = 0; i < n; i++) x[i] *= gain;

  let peak2 = 0, sq2 = 0;
  for (let i = 0; i < n; i++) {
    sq2 += x[i] * x[i];
    const a = Math.abs(x[i]);
    if (a > peak2) peak2 = a;
  }
  const hf = highpass(x, sr, 4000, 0.707);
  let hfEnergy = 0;
  for (let i = 0; i < n; i++) hfEnergy += hf[i] * hf[i];
  report.peak = peak2;
  report.rms = Math.sqrt(sq2 / (n || 1));
  report.speechRatio = energies.length ? active / energies.length : 0;
  report.noiseFloor = lowFloor;
  report.speechLevel = speechLevel;
  report.dynamicDb = 20 * Math.log10((speechLevel + 1e-6) / (lowFloor + 1e-6));
  report.hfRatio = sq2 > 1e-9 ? hfEnergy / sq2 : 0;
  report.gain = gain;

  return { samples: x, sr, report };
}

// Rate suitability for voice conditioning. Never blocks saving; only warns.
export function rateReference(report) {
  const reasons = [];
  let level = "good";
  if (!report || report.duration < 0.7) {
    level = "bad";
    reasons.push("too-short");
  } else if (report.rms < 0.006) {
    level = "bad";
    reasons.push("too-quiet");
  } else if (report.speechRatio < 0.18) {
    level = "bad";
    reasons.push("no-speech");
  }
  if (report && report.clippingRatio > 0.005 && level !== "bad") level = "warn";
  if (report && report.clippingRatio > 0.005) reasons.push("clipping");
  if (report && report.hfRatio > 0.42 && level !== "bad") level = "warn";
  if (report && report.hfRatio > 0.42) reasons.push("noisy");
  if (report && report.duration >= 0.7 && report.duration < 1.2 && level === "good") level = "warn";
  if (report && report.duration >= 0.7 && report.duration < 1.2) reasons.push("short");
  return { level, reasons };
}

// Brightness proxy: share of energy above 1.2 kHz.
export function spectralTilt(samples, sr) {
  const hp = highpass(samples, sr, 1200, 0.707);
  let hi = 0, all = 0;
  for (let i = 0; i < samples.length; i++) {
    hi += hp[i] * hp[i];
    all += samples[i] * samples[i];
  }
  if (all < 1e-9) return 0.4;
  return Math.max(0.05, Math.min(0.95, hi / all));
}

export function validateSpeech(samples, sr) {
  if (!samples || !samples.length || sr <= 0) return { ok: false, reason: "empty" };
  let peak = 0, sq = 0, bad = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) bad += 1;
    else {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sq += v * v;
    }
  }
  const r = Math.sqrt(sq / samples.length);
  if (bad > 0) return { ok: false, reason: "invalid" };
  if (samples.length / sr < 0.12) return { ok: false, reason: "too-short" };
  if (r < 0.004) return { ok: false, reason: "silent" };
  if (peak < 0.02) return { ok: false, reason: "silent" };
  return { ok: true, rms: r, peak };
}

export function samplesToBuffer(ctx, samples, sr) {
  const buf = ctx.createBuffer(1, samples.length, sr);
  buf.copyToChannel(samples, 0);
  return buf;
}

export function encodeWav(samples, sr) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const write = (off, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

export { rms };
