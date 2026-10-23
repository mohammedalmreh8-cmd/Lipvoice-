import { phonesForText } from "./pronounce.js";
import { decodeToMono, preprocessReference, rateReference, spectralTilt, highpass } from "./audio.js";

const FRAME_MS = 5;

const PH = {
  REST: { f: [320, 1440, 2760, 3500], b: [60, 90, 150, 200], av: 0, af: 0, ah: 0, ms: 60 },
  IY: { f: [270, 2290, 3010, 3500], b: [50, 90, 130, 200], av: 1, af: 0, ah: 0.02, ms: 130 },
  IH: { f: [400, 1990, 2550, 3500], b: [50, 90, 130, 200], av: 1, af: 0, ah: 0.02, ms: 90 },
  EH: { f: [530, 1840, 2480, 3500], b: [60, 90, 150, 200], av: 1, af: 0, ah: 0.02, ms: 110 },
  AE: { f: [660, 1720, 2410, 3500], b: [70, 100, 150, 200], av: 1, af: 0, ah: 0.02, ms: 130 },
  AA: { f: [730, 1090, 2440, 3500], b: [70, 80, 150, 200], av: 1, af: 0, ah: 0.02, ms: 140 },
  AO: { f: [570, 840, 2410, 3300], b: [70, 80, 150, 200], av: 1, af: 0, ah: 0.02, ms: 130 },
  UH: { f: [440, 1020, 2240, 3300], b: [70, 80, 140, 200], av: 1, af: 0, ah: 0.02, ms: 90 },
  UW: { f: [300, 870, 2240, 3200], b: [50, 80, 140, 200], av: 1, af: 0, ah: 0.02, ms: 140 },
  AH: { f: [520, 1190, 2390, 3500], b: [60, 90, 150, 200], av: 1, af: 0, ah: 0.02, ms: 90 },
  ER: { f: [490, 1350, 1690, 3300], b: [70, 100, 120, 200], av: 1, af: 0, ah: 0.02, ms: 130 },
  L: { f: [360, 1100, 2600, 3500], b: [50, 80, 140, 200], av: 0.85, af: 0, ah: 0.02, ms: 90 },
  R: { f: [420, 1050, 1550, 3300], b: [60, 90, 120, 200], av: 0.85, af: 0, ah: 0.02, ms: 100 },
  W: { f: [300, 610, 2200, 3200], b: [50, 80, 140, 200], av: 0.9, af: 0, ah: 0.02, ms: 90 },
  Y: { f: [280, 2200, 3000, 3500], b: [50, 90, 140, 200], av: 0.9, af: 0, ah: 0.02, ms: 80 },
  M: { f: [280, 900, 2200, 3300], b: [60, 80, 140, 200], av: 0.7, af: 0, ah: 0, ms: 90 },
  N: { f: [280, 1400, 2300, 3300], b: [60, 90, 140, 200], av: 0.7, af: 0, ah: 0, ms: 90 },
  NG: { f: [280, 1100, 2300, 3300], b: [60, 90, 140, 200], av: 0.7, af: 0, ah: 0, ms: 100 },
  F: { f: [400, 1000, 2200, 3500], b: [80, 120, 180, 250], av: 0, af: 0.7, ah: 0, fn: 1400, bn: 1800, ms: 110 },
  V: { f: [400, 1000, 2200, 3500], b: [80, 120, 180, 250], av: 0.45, af: 0.45, ah: 0, fn: 1400, bn: 1800, ms: 90 },
  TH: { f: [400, 1400, 2500, 3500], b: [80, 120, 180, 250], av: 0, af: 0.65, ah: 0, fn: 2200, bn: 2000, ms: 100 },
  DH: { f: [400, 1400, 2500, 3500], b: [80, 120, 180, 250], av: 0.4, af: 0.4, ah: 0, fn: 2200, bn: 2000, ms: 80 },
  S: { f: [320, 1400, 2700, 4000], b: [70, 120, 180, 250], av: 0, af: 0.85, ah: 0, fn: 5500, bn: 1400, ms: 120 },
  Z: { f: [320, 1400, 2700, 4000], b: [70, 120, 180, 250], av: 0.4, af: 0.55, ah: 0, fn: 5500, bn: 1400, ms: 100 },
  SH: { f: [350, 1800, 2500, 3500], b: [70, 120, 160, 220], av: 0, af: 0.8, ah: 0, fn: 3200, bn: 1200, ms: 130 },
  ZH: { f: [350, 1800, 2500, 3500], b: [70, 120, 160, 220], av: 0.4, af: 0.5, ah: 0, fn: 3200, bn: 1200, ms: 110 },
  H: { f: [500, 1500, 2500, 3500], b: [80, 120, 180, 250], av: 0.08, af: 0, ah: 0.7, ms: 80 },
  HH: { f: [500, 1500, 2500, 3500], b: [80, 120, 180, 250], av: 0.08, af: 0, ah: 0.7, ms: 80 },
  CH: { f: [350, 1800, 2500, 3500], b: [70, 120, 160, 220], av: 0, af: 0.8, ah: 0, fn: 3200, bn: 1200, ms: 50 },
  JH: { f: [350, 1800, 2500, 3500], b: [70, 120, 160, 220], av: 0.35, af: 0.55, ah: 0, fn: 3200, bn: 1200, ms: 50 },
};

const STOPS = {
  P: { fn: 1400, voiced: 0, msClose: 55, msBurst: 12 },
  B: { fn: 900, voiced: 1, msClose: 45, msBurst: 10 },
  T: { fn: 4200, voiced: 0, msClose: 50, msBurst: 10 },
  D: { fn: 3500, voiced: 1, msClose: 40, msBurst: 10 },
  K: { fn: 2200, voiced: 0, msClose: 55, msBurst: 12 },
  G: { fn: 1800, voiced: 1, msClose: 45, msBurst: 10 },
};

function mulberry(seed) {
  let t = (seed + 0x6d2b79f5) >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function median(values) {
  if (!values.length) return 0;
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function frameF0(slice, sr) {
  const minLag = Math.max(24, Math.floor(sr / 340));
  const maxLag = Math.min(slice.length - 2, Math.floor(sr / 70));
  let energy = 0;
  for (let i = 0; i < slice.length; i++) energy += slice[i] * slice[i];
  if (energy / slice.length < 0.0002) return 0;
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const count = slice.length - lag;
    for (let i = 0; i < count; i++) sum += slice[i] * slice[i + lag];
    const corr = sum / (count || 1);
    if (corr > best) {
      best = corr;
      bestLag = lag;
    }
  }
  if (best < 0.00008) return 0;
  return sr / bestLag;
}

function analyzeVoice(cleaned, sr) {
  const win = Math.floor(sr * 0.04);
  const hop = Math.floor(sr * 0.01);
  const f0s = [];
  let voiced = 0, frames = 0;
  for (let i = 0; i + win < cleaned.length; i += hop) {
    const slice = cleaned.subarray(i, i + win);
    let e = 0, zc = 0;
    for (let n = 0; n < slice.length; n++) {
      const x = slice[n];
      e += x * x;
      if (n && (slice[n - 1] >= 0) !== (x >= 0)) zc += 1;
    }
    const rms = Math.sqrt(e / slice.length);
    if (rms < 0.01) continue;
    frames += 1;
    const f0 = frameF0(slice, sr);
    if (f0 >= 70 && f0 <= 360 && zc / slice.length < 0.18) {
      f0s.push(f0);
      voiced += 1;
    }
  }
  const f0 = median(f0s) || 130;
  const brightness = spectralTilt(cleaned, sr);
  const formantScale = Math.max(0.88, Math.min(1.16, 0.94 + (f0 - 120) / 1400));
  return { f0, brightness, formantScale, voiced: frames ? voiced / frames : 0 };
}

export async function buildDonor(blob, ctx) {
  if (!blob || !ctx) throw new Error("no-audio");
  const { samples, sampleRate } = await decodeToMono(blob, ctx);
  const cleaned = preprocessReference(samples, sampleRate);
  const report = cleaned.report;
  const rating = rateReference(report);
  const voice = analyzeVoice(cleaned.samples, cleaned.sr);
  if (voice.voiced < 0.1) {
    report.voiced = voice.voiced;
    if (rating.level === "good") rating.level = "warn";
    if (!rating.reasons.includes("quiet-voice")) rating.reasons.push("quiet-voice");
  }
  return {
    f0: voice.f0,
    brightness: voice.brightness,
    formantScale: voice.formantScale,
    voiced: voice.voiced,
    rms: report.rms,
    sr: cleaned.sr,
    report,
    rating,
    cleaned: cleaned.samples,
  };
}

function Resonator() {
  this.a = 1;
  this.b1 = 0;
  this.b2 = 0;
  this.y1 = 0;
  this.y2 = 0;
}

Resonator.prototype.set = function set(freq, bw, sr) {
  const f = Math.min(Math.max(40, freq), sr * 0.45);
  const b = Math.max(40, bw);
  const r = Math.exp((-Math.PI * b) / sr);
  const theta = (2 * Math.PI * f) / sr;
  this.b1 = 2 * r * Math.cos(theta);
  this.b2 = -r * r;
  this.a = 1 - this.b1 - this.b2;
};

Resonator.prototype.tick = function tick(x) {
  const y = this.a * x + this.b1 * this.y1 + this.b2 * this.y2;
  this.y2 = this.y1;
  this.y1 = y;
  return y;
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function copyTarget(src, fs) {
  return {
    f: src.f.map((v) => v * fs),
    b: src.b.slice(),
    av: src.av,
    af: src.af,
    ah: src.ah,
    fn: (src.fn || 2500) * Math.sqrt(fs),
    bn: src.bn || 1200,
    ms: src.ms,
  };
}

function segsFor(phone, fs) {
  const stop = STOPS[phone];
  if (stop) {
    const close = copyTarget(PH.REST, fs);
    close.av = stop.voiced ? 0.08 : 0;
    close.ah = 0;
    close.af = 0;
    close.ms = stop.msClose;
    const burst = copyTarget(PH.REST, fs);
    burst.av = 0;
    burst.af = 0.7;
    burst.ah = 0;
    burst.fn = stop.fn * Math.sqrt(fs);
    burst.bn = Math.max(500, stop.fn * 0.35);
    burst.ms = stop.msBurst;
    const rel = copyTarget(PH.AH, fs);
    rel.av = stop.voiced ? 0.35 : 0.06;
    rel.ah = 0;
    rel.ms = 20;
    return [close, burst, rel];
  }
  const base = PH[phone] || PH.AH;
  return [copyTarget(base, fs)];
}

function rosenberg(p) {
  const tp = 0.6;
  const tn = 0.18;
  if (p < tp) {
    const x = p / tp;
    return 0.5 * (1 - Math.cos(Math.PI * x));
  }
  if (p < tp + tn) {
    const x = (p - tp) / tn;
    return Math.cos((Math.PI * x) / 2);
  }
  return 0;
}

export function synthesizePhrase(donor, text, lang = "en", sampleRate = 22050) {
  const phones = phonesForText(text, lang).filter(Boolean);
  if (!phones.length) return null;
  const sr = sampleRate;
  const f0 = Math.max(90, Math.min(280, donor?.f0 || 140));
  const fs = Math.max(0.88, Math.min(1.16, donor?.formantScale || 1));
  const bright = Math.max(0.15, Math.min(0.75, donor?.brightness ?? 0.35));

  const segs = [];
  phones.forEach((phone) => {
    segsFor(phone, fs).forEach((s) => segs.push(s));
  });
  if (!segs.length) return null;

  const frameN = Math.max(1, Math.round((FRAME_MS / 1000) * sr));
  const frames = [];
  segs.forEach((seg, si) => {
    const nF = Math.max(1, Math.round(seg.ms / FRAME_MS));
    const next = segs[si + 1] || seg;
    for (let k = 0; k < nF; k++) {
      const u = nF === 1 ? 1 : k / (nF - 1);
      const edge = k === 0 || k === nF - 1 ? 0.75 : 1;
      frames.push({
        f: [
          lerp(seg.f[0], next.f[0], u * 0.22),
          lerp(seg.f[1], next.f[1], u * 0.22),
          lerp(seg.f[2], next.f[2], u * 0.22),
          lerp(seg.f[3], next.f[3], u * 0.22),
        ],
        b: [90, 110, 150, 220],
        av: seg.av * edge,
        af: seg.af * edge,
        ah: seg.ah * edge,
        fn: lerp(seg.fn, next.fn, u * 0.22),
        bn: Math.max(400, seg.bn),
      });
    }
  });

  const pad = Math.round((40 / 1000) * sr);
  const outLen = pad + frames.length * frameN + Math.round((80 / 1000) * sr);
  const out = new Float32Array(outLen);

  const r1 = new Resonator();
  const r2 = new Resonator();
  const r3 = new Resonator();
  const r4 = new Resonator();
  const rnz = new Resonator();

  const rand = mulberry(Math.round(f0 * 13 + text.length * 17 + fs * 200));
  let phase = 0;
  let prevG = 0;
  let t = pad;
  const g1 = 0.22;
  const g2 = 1.28 + bright * 0.12;
  const g3 = 0.72 + bright * 0.18;
  const g4 = 0.22 + bright * 0.1;

  for (let fi = 0; fi < frames.length; fi++) {
    const fr = frames[fi];
    r1.set(fr.f[0], fr.b[0], sr);
    r2.set(fr.f[1], fr.b[1], sr);
    r3.set(fr.f[2], fr.b[2], sr);
    r4.set(fr.f[3], fr.b[3], sr);
    rnz.set(fr.fn, Math.max(500, fr.bn), sr);

    const prog = fi / frames.length;
    const localF0 = f0 * (1 + 0.03 * Math.sin(Math.PI * Math.min(1, prog * 1.05)) - 0.035 * prog);

    for (let i = 0; i < frameN && t < outLen; i++) {
      phase += localF0 / sr;
      if (phase >= 1) phase -= 1;
      const g = rosenberg(phase);
      const src = (g - prevG) * fr.av;
      prevG = g;
      let y = r1.tick(src) * g1 + r2.tick(src) * g2 + r3.tick(src) * g3 + r4.tick(src) * g4;
      if (fr.af > 0.05) y += rnz.tick(rand() * 2 - 1) * fr.af * 0.045;
      out[t] = y;
      t += 1;
    }
  }

  let x = highpass(out, sr, 80, 0.707);
  let peak = 1e-9, sq = 0, zc = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    sq += x[i] * x[i];
    if (i && (x[i - 1] >= 0) !== (x[i] >= 0)) zc += 1;
  }
  const gain = 0.68 / peak;
  const last = Math.min(x.length, t + pad);
  const samples = new Float32Array(last);
  for (let i = 0; i < last; i++) samples[i] = x[i] * gain;
  const rms = Math.sqrt(sq / x.length) * gain;
  const zcr = zc / x.length;
  return {
    samples,
    sr,
    diag: {
      engine: "klatt-parallel",
      format: "pcm-f32-mono",
      sampleRate: sr,
      channels: 1,
      duration: last / sr,
      peak: 0.68,
      rms,
      zcr,
      f0,
      formantScale: fs,
      phones: phones.join(" "),
      text,
    },
  };
}

export function bufferFromSynth(ctx, synth) {
  const buf = ctx.createBuffer(1, synth.samples.length, synth.sr);
  buf.copyToChannel(synth.samples, 0);
  return buf;
}
