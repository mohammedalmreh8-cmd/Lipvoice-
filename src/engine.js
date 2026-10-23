import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { ESSENTIALS_BY_LANG } from "./i18n.js";

const LIP_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const LIP_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];

export const ESSENTIALS = ESSENTIALS_BY_LANG.en;

export function essentialsFor(lang) {
  return ESSENTIALS_BY_LANG[lang] || ESSENTIALS_BY_LANG.en;
}

export const TARGET_TAKES = 8;
export const ANGLE_SLOTS = ["front", "left", "right", "near", "far"];
const SAMPLE_LEN = 36;
const FEATURE_DIM = 18;
const TIME_INDEX = 18;
const FRAME_MS = 1000 / 30;
const VEL_SCALE = 3.2;
const ACC_SCALE = 55;
const STORE_VERSION = 4;
const STORE_KEY = "lipvoice-store";
const MATCH_TEMPO = [1, 0.84, 1.18];
const CLASH_LIMIT = 0.048;

const POS_WEIGHTS = [
  1.6, 1.8, 1.7, 1.15, 1.4, 1.2, 1.35, 2.2, 2.4, 1.1, 1.05, 2.2, 2.0, 1.35, 1.2, 1.25, 1.5, 1.3,
];
const VEL_WEIGHTS = POS_WEIGHTS.map((w, i) => w * ([7, 8, 11, 12, 13, 16].includes(i) ? 1.2 : 0.72));
const ACC_WEIGHTS = POS_WEIGHTS.map((w, i) => w * ([7, 8, 11, 12, 13].includes(i) ? 0.62 : 0.38));
const WEIGHTS = [...POS_WEIGHTS, ...VEL_WEIGHTS, ...ACC_WEIGHTS];

function blendMap(categories) {
  const map = {};
  for (const item of categories || []) map[item.categoryName] = item.score;
  return map;
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.hypot(dx, dy, dz);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function extractFeatures(landmarks, blendshapes, time = 0) {
  const b = blendMap(blendshapes);
  const left = landmarks[61];
  const right = landmarks[291];
  const top = landmarks[13];
  const bottom = landmarks[14];
  const outerTop = landmarks[0];
  const outerBot = landmarks[17];
  const innerL = landmarks[78];
  const innerR = landmarks[308];
  const nose = landmarks[1];
  const chin = landmarks[152];
  const cheekL = landmarks[234];
  const cheekR = landmarks[454];
  const faceScale = dist(cheekL, cheekR) || dist(nose, chin) || 0.2;
  const width = dist(left, right) || 0.001;
  const height = dist(top, bottom);
  const outerH = dist(outerTop, outerBot);
  const innerW = dist(innerL, innerR) || 0.001;
  const smile = ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2;
  const press = ((b.mouthPressLeft || 0) + (b.mouthPressRight || 0)) / 2;
  const stretch = ((b.mouthStretchLeft || 0) + (b.mouthStretchRight || 0)) / 2;
  const leftLift = Math.abs((left.y || 0) - (top.y || 0));
  const rightLift = Math.abs((right.y || 0) - (top.y || 0));
  const openN = clamp01(height / (faceScale * 0.22));
  const widthN = clamp01(width / (faceScale * 0.55));
  const row = [
    b.jawOpen || 0,
    b.mouthPucker || 0,
    b.mouthFunnel || 0,
    smile,
    press,
    stretch,
    b.mouthClose || 0,
    height / width,
    openN,
    b.mouthShrugUpper || 0,
    Math.abs((b.mouthLeft || 0) - (b.mouthRight || 0)),
    widthN,
    clamp01(outerH / (faceScale * 0.28)),
    clamp01(innerW / width),
    clamp01(Math.abs(leftLift - rightLift) / (faceScale * 0.08)),
    clamp01(((b.mouthLowerDownLeft || 0) + (b.mouthLowerDownRight || 0)) / 2),
    clamp01(height * width * 12),
    clamp01(Math.abs((b.mouthPucker || 0) - (b.mouthFunnel || 0))),
  ];
  row.push(Number.isFinite(time) ? time : 0);
  return row;
}

export function visemeFromFeatures(f) {
  const [jaw, pucker, funnel, smile, press, stretch, close, aspect, openN] = f;
  if (close > 0.36 && jaw < 0.16 && openN < 0.18) return "M/B/P";
  if (pucker > 0.26 && jaw < 0.34 && smile < 0.28) return "OO/W";
  if (funnel > 0.2 && pucker < 0.5) return "OH";
  if (smile > 0.24 && jaw < 0.42) return "EE";
  if (press > 0.26 && openN > 0.08 && openN < 0.36 && jaw > 0.08) return "F/V";
  if (jaw > 0.32 || openN > 0.32 || aspect > 0.34) return "AH";
  if (stretch > 0.2) return "EH";
  if (jaw > 0.1 || openN > 0.12) return "UH";
  return "REST";
}

function motionEnergy(f) {
  return (f[0] || 0) + (f[1] || 0) + (f[2] || 0) + (f[3] || 0) * 0.45 + (f[8] || 0) * 1.15 + (f[11] || 0) * 0.35;
}

export function isSpeaking(features, viseme) {
  const energy = motionEnergy(features);
  const jaw = features[0] || 0;
  const open = features[8] || 0;
  if (viseme === "REST" && energy < 0.26) return false;
  return energy > 0.28 && (jaw > 0.1 || open > 0.1);
}

export function createSpeechDetector() {
  let speaking = false;
  let startCount = 0;
  let stopCount = 0;
  let baseline = 0.14;

  return {
    update(features, viseme) {
      const energy = motionEnergy(features);
      const jaw = features[0] || 0;
      const open = features[8] || 0;
      if (!speaking) baseline = baseline * 0.94 + Math.min(energy, 0.28) * 0.06;
      const burst = energy > Math.max(0.16, baseline + 0.05) && (jaw > 0.06 || open > 0.08 || viseme !== "REST");

      if (!speaking) {
        startCount = burst ? startCount + 1 : Math.max(0, startCount - 1);
        if (startCount >= 2) {
          speaking = true;
          stopCount = 0;
        }
      } else {
        const resting =
          viseme === "REST" ||
          (energy < baseline + 0.08 && open < 0.16 && jaw < 0.16);
        stopCount = resting ? stopCount + 1 : Math.max(0, stopCount - 1);
        if (stopCount >= 6) {
          speaking = false;
          startCount = 0;
        }
      }
      return speaking;
    },
    reset() {
      speaking = false;
      startCount = 0;
      stopCount = 0;
    },
  };
}

function smooth(seq) {
  if (seq.length < 3) return seq.map((f) => f.slice());
  const out = [];
  for (let i = 0; i < seq.length; i++) {
    const a = seq[Math.max(0, i - 1)];
    const b = seq[i];
    const c = seq[Math.min(seq.length - 1, i + 1)];
    out.push(b.map((v, k) => (a[k] + v + c[k]) / 3));
  }
  return out;
}

function trimSpeech(seq) {
  if (seq.length < 4) return seq;
  const energy = seq.map(motionEnergy);
  const peak = Math.max(...energy);
  const cut = Math.max(0.1, peak * 0.14);
  let start = 0;
  let end = seq.length - 1;
  while (start < end && energy[start] < cut) start += 1;
  while (end > start && energy[end] < cut) end -= 1;
  return seq.slice(start, end + 1);
}

function padFeatures(row) {
  const out = row.slice(0, FEATURE_DIM);
  while (out.length < FEATURE_DIM) out.push(0);
  return out;
}

function frameTime(row, index, fallbackDt = FRAME_MS) {
  const t = row?.[TIME_INDEX];
  if (Number.isFinite(t) && t > 0) return t;
  return index * fallbackDt;
}

function frameInterval(seq, i) {
  if (i <= 0) return FRAME_MS;
  const dt = frameTime(seq[i], i) - frameTime(seq[i - 1], i - 1);
  if (!Number.isFinite(dt) || dt <= 0) return FRAME_MS;
  return Math.max(12, Math.min(120, dt));
}

function withMotion(seq) {
  const out = [];
  let prevVel = new Array(FEATURE_DIM).fill(0);
  for (let i = 0; i < seq.length; i++) {
    const cur = padFeatures(seq[i]);
    const prev = padFeatures(seq[Math.max(0, i - 1)]);
    const dt = frameInterval(seq, i) / 1000;
    const vel = [];
    const acc = [];
    for (let k = 0; k < FEATURE_DIM; k++) {
      const v = (cur[k] - prev[k]) / (dt || 0.033);
      vel.push(clamp01((v / VEL_SCALE + 1) / 2));
      acc.push(clamp01(((v - prevVel[k]) / (dt || 0.033) / ACC_SCALE + 1) / 2));
    }
    prevVel = vel.map((_, k) => (cur[k] - prev[k]) / (dt || 0.033));
    out.push([...cur, ...vel, ...acc]);
  }
  return out;
}

function resampleTimed(seq, len = SAMPLE_LEN) {
  if (!seq.length) return [];
  if (seq.length === 1) return Array.from({ length: len }, () => seq[0].slice());
  const t0 = frameTime(seq[0], 0);
  const t1 = frameTime(seq[seq.length - 1], seq.length - 1);
  const span = Math.max(FRAME_MS, t1 - t0);
  const out = [];
  let j = 0;
  for (let i = 0; i < len; i++) {
    const target = t0 + (i / (len - 1)) * span;
    while (j < seq.length - 2 && frameTime(seq[j + 1], j + 1) < target) j += 1;
    const a = seq[j];
    const b = seq[Math.min(seq.length - 1, j + 1)];
    const ta = frameTime(a, j);
    const tb = frameTime(b, j + 1);
    const u = tb === ta ? 0 : Math.max(0, Math.min(1, (target - ta) / (tb - ta)));
    const dim = Math.min(a.length, b.length, FEATURE_DIM);
    const row = [];
    for (let k = 0; k < dim; k++) row.push(a[k] * (1 - u) + b[k] * u);
    while (row.length < FEATURE_DIM) row.push(0);
    row.push(target);
    out.push(row);
  }
  return out;
}

function prepare(seq) {
  return withMotion(resampleTimed(smooth(trimSpeech(seq))));
}

function meanVec(seq) {
  if (!seq.length) return [];
  const dim = seq[0].length;
  const acc = new Array(dim).fill(0);
  for (const row of seq) {
    for (let k = 0; k < dim; k++) acc[k] += row[k] || 0;
  }
  return acc.map((v) => v / seq.length);
}

function peakVec(seq) {
  if (!seq.length) return [];
  const dim = seq[0].length;
  const acc = new Array(dim).fill(0);
  for (const row of seq) {
    for (let k = 0; k < dim; k++) acc[k] = Math.max(acc[k], row[k] || 0);
  }
  return acc;
}

function vecDist(a, b, weights) {
  const dim = Math.min(a.length, b.length);
  let sum = 0;
  let wsum = 0;
  for (let k = 0; k < dim; k++) {
    const w = weights[k] || 1;
    const d = (a[k] || 0) - (b[k] || 0);
    sum += w * d * d;
    wsum += w;
  }
  return Math.sqrt(sum / (wsum || 1));
}

function dtw(a, b, weights) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return Infinity;
  const inf = 1e9;
  let prev = new Array(m + 1).fill(inf);
  let curr = new Array(m + 1).fill(inf);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    curr[0] = inf;
    const va = a[i - 1];
    for (let j = 1; j <= m; j++) {
      const vb = b[j - 1];
      const dim = Math.min(va.length, vb.length);
      let cost = 0;
      let wsum = 0;
      for (let k = 0; k < dim; k++) {
        const w = weights[k] || 1;
        const d = va[k] - vb[k];
        cost += w * d * d;
        wsum += w;
      }
      curr[j] = cost / (wsum || 1) + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[m] / (n + m);
}

const CONFUSION = {
  AH: { UH: 0.35, OH: 0.45, EH: 0.55 },
  UH: { AH: 0.35, OH: 0.45, "OO/W": 0.55 },
  OH: { "OO/W": 0.3, AH: 0.45, UH: 0.45 },
  "OO/W": { OH: 0.3, UH: 0.5 },
  EE: { EH: 0.4 },
  EH: { EE: 0.4, AH: 0.55, UH: 0.6 },
  "M/B/P": { "F/V": 0.65 },
  "F/V": { "M/B/P": 0.65 },
};

function visemeCost(a, b) {
  if (a === b) return 0;
  return CONFUSION[a]?.[b] ?? CONFUSION[b]?.[a] ?? 1;
}

function timedVisemes(seq) {
  const events = [];
  let last = "REST";
  let hold = 0;
  for (const f of seq) {
    const v = visemeFromFeatures(f);
    if (v === last) {
      hold += 1;
      continue;
    }
    if (last !== "REST" && hold >= 1) events.push({ v: last, d: hold });
    last = v;
    hold = 1;
  }
  if (last !== "REST" && hold >= 1) events.push({ v: last, d: hold });
  return events;
}

function uniqueVisemes(seq) {
  return timedVisemes(seq).map((e) => e.v);
}

function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = visemeCost(a[i - 1], b[j - 1]);
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[n][m];
}

function visemeScore(a, b) {
  if (!a.length && !b.length) return 0;
  if (!a.length || !b.length) return 1;
  return editDistance(a, b) / Math.max(a.length, b.length);
}

export function facePose(landmarks) {
  const left = landmarks[234];
  const right = landmarks[454];
  const nose = landmarks[1];
  const chin = landmarks[152];
  const brow = landmarks[10];
  if (!left || !right || !nose) return { yaw: 0, pitch: 0, scale: 0, slot: "front" };
  const width = dist(left, right) || 1;
  const yaw = (nose.x - (left.x + right.x) / 2) / width;
  const midY = ((brow?.y || nose.y) + (chin?.y || nose.y)) / 2;
  const pitch = (nose.y - midY) / width;
  const scale = width;
  let slot = "front";
  if (scale > 0.4) slot = "near";
  else if (scale < 0.2) slot = "far";
  else if (yaw > 0.07) slot = "left";
  else if (yaw < -0.07) slot = "right";
  return { yaw, pitch, scale, slot };
}

export function faceQuality(landmarks) {
  const left = landmarks[234];
  const right = landmarks[454];
  const nose = landmarks[1];
  const mouthL = landmarks[61];
  const mouthR = landmarks[291];
  if (!left || !right || !nose || !mouthL || !mouthR) return { ok: false, reason: "no-face" };
  const width = dist(left, right);
  const mouthW = dist(mouthL, mouthR);
  const yaw = Math.abs(nose.x - (left.x + right.x) / 2) / (width || 1);
  if (width < 0.16) return { ok: false, reason: "too-far" };
  if (yaw > 0.28) return { ok: false, reason: "turned" };
  if (mouthW / (width || 1) < 0.12) return { ok: false, reason: "mouth-hidden" };
  return { ok: true, reason: "ok", width, yaw };
}

export function trainFaceQuality(landmarks) {
  const left = landmarks[234];
  const right = landmarks[454];
  const nose = landmarks[1];
  const mouthL = landmarks[61];
  const mouthR = landmarks[291];
  if (!left || !right || !nose || !mouthL || !mouthR) return { ok: false, reason: "no-face" };
  const width = dist(left, right);
  const mouthW = dist(mouthL, mouthR);
  const yaw = Math.abs(nose.x - (left.x + right.x) / 2) / (width || 1);
  if (width < 0.12) return { ok: false, reason: "too-far" };
  if (yaw > 0.42) return { ok: false, reason: "turned" };
  if (mouthW / (width || 1) < 0.1) return { ok: false, reason: "mouth-hidden" };
  return { ok: true, reason: "ok", width, yaw };
}

function unwrapTake(take) {
  if (!take) return { seq: [], pose: null };
  if (Array.isArray(take)) return { seq: take, pose: null };
  return { seq: take.seq || [], pose: take.pose || null };
}

function takeSeq(take) {
  return unwrapTake(take).seq;
}

function durationPenalty(n, m) {
  const ratio = Math.max(n, m) / Math.max(1, Math.min(n, m));
  if (ratio <= 1.85) return 0;
  return Math.min(0.28, (ratio - 1.85) * 0.22);
}

function channelSeries(seq, index) {
  return seq.map((row) => row[index] || 0);
}

function turningPoints(series, eps = 0.035) {
  if (series.length < 3) return 0;
  let n = 0;
  let dir = 0;
  for (let i = 1; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (Math.abs(d) < eps) continue;
    const now = d > 0 ? 1 : -1;
    if (dir && now !== dir) n += 1;
    dir = now;
  }
  return n;
}

function dynamicsProfile(seq) {
  const open = channelSeries(seq, 8);
  const width = channelSeries(seq, 11);
  const aspect = channelSeries(seq, 7);
  const area = channelSeries(seq, 16);
  const t0 = frameTime(seq[0], 0);
  const t1 = frameTime(seq[seq.length - 1], seq.length - 1);
  const durMs = Math.max(FRAME_MS, t1 - t0);
  let travelOpen = 0;
  let travelWidth = 0;
  let speedSum = 0;
  let accSum = 0;
  let prevV = 0;
  for (let i = 1; i < seq.length; i++) {
    const dt = frameInterval(seq, i) / 1000;
    const dOpen = Math.abs(open[i] - open[i - 1]);
    const dWidth = Math.abs(width[i] - width[i - 1]);
    travelOpen += dOpen;
    travelWidth += dWidth;
    const v = (dOpen + dWidth) / (dt || 0.033);
    speedSum += v;
    accSum += Math.abs(v - prevV) / (dt || 0.033);
    prevV = v;
  }
  const n = Math.max(1, seq.length - 1);
  return {
    peakOpen: Math.max(...open),
    peakWidth: Math.max(...width),
    meanOpen: open.reduce((a, b) => a + b, 0) / seq.length,
    meanWidth: width.reduce((a, b) => a + b, 0) / seq.length,
    meanAspect: aspect.reduce((a, b) => a + b, 0) / seq.length,
    meanArea: area.reduce((a, b) => a + b, 0) / seq.length,
    travelOpen,
    travelWidth,
    meanSpeed: speedSum / n,
    meanAcc: accSum / n,
    openTurns: turningPoints(open),
    widthTurns: turningPoints(width, 0.025),
    durMs,
  };
}

function dynamicsDist(a, b) {
  if (!a || !b) return 0.12;
  const rel = (x, y, scale) => Math.min(1, Math.abs((x || 0) - (y || 0)) / scale);
  return (
    rel(a.peakOpen, b.peakOpen, 0.7) * 0.18 +
    rel(a.meanOpen, b.meanOpen, 0.5) * 0.12 +
    rel(a.peakWidth, b.peakWidth, 0.55) * 0.12 +
    rel(a.meanWidth, b.meanWidth, 0.5) * 0.08 +
    rel(a.travelOpen, b.travelOpen, 1.6) * 0.14 +
    rel(a.travelWidth, b.travelWidth, 1.2) * 0.08 +
    rel(a.meanSpeed, b.meanSpeed, 12) * 0.1 +
    rel(a.meanAcc, b.meanAcc, 60) * 0.05 +
    Math.min(1, Math.abs((a.openTurns || 0) - (b.openTurns || 0)) / 8) * 0.05 +
    rel(a.durMs, b.durMs, 1400) * 0.08
  );
}

function takeStats(seq) {
  const clean = trimSpeech(smooth(seq));
  return {
    visemes: uniqueVisemes(clean),
    mean: meanVec(clean.map(padFeatures)),
    peak: peakVec(clean.map(padFeatures)),
    len: clean.length,
    prepared: prepare(seq),
    dyn: dynamicsProfile(clean),
  };
}

function scoreAgainstTake(query, take) {
  const q = query.prepared;
  const t = take.prepared;
  const dtwPart = dtw(q, t, WEIGHTS);
  const vis = visemeScore(query.visemes, take.visemes);
  const mean = vecDist(query.mean, take.mean, POS_WEIGHTS);
  const peak = vecDist(query.peak, take.peak, POS_WEIGHTS);
  const dur = durationPenalty(query.len, take.len);
  const dyn = dynamicsDist(query.dyn, take.dyn);
  return 0.46 * dtwPart + 0.18 * vis + 0.14 * mean + 0.08 * peak + 0.04 * dur + 0.1 * dyn;
}

function prototypeTakes(takes) {
  const ready = takes.map((take) => prepare(takeSeq(take))).filter((s) => s.length);
  if (!ready.length) return null;
  const dim = Math.min(...ready.map((s) => s[0].length));
  const proto = [];
  for (let i = 0; i < SAMPLE_LEN; i++) {
    const row = new Array(dim).fill(0);
    for (const seq of ready) {
      for (let k = 0; k < dim; k++) row[k] += seq[i][k] || 0;
    }
    proto.push(row.map((v) => v / ready.length));
  }
  return proto;
}

function stretchSeq(seq, factor) {
  const out = [];
  const n = Math.max(8, Math.round(seq.length * factor));
  const t0 = frameTime(seq[0], 0);
  const t1 = frameTime(seq[seq.length - 1], seq.length - 1);
  for (let i = 0; i < n; i++) {
    const t = (i / Math.max(1, n - 1)) * (seq.length - 1);
    const i0 = Math.floor(t);
    const i1 = Math.min(seq.length - 1, i0 + 1);
    const u = t - i0;
    const dim = Math.min(seq[i0].length, seq[i1].length, FEATURE_DIM);
    const row = [];
    for (let k = 0; k < dim; k++) row.push(seq[i0][k] * (1 - u) + seq[i1][k] * u);
    while (row.length < FEATURE_DIM) row.push(0);
    row.push(t0 + (i / Math.max(1, n - 1)) * Math.max(FRAME_MS, t1 - t0) * factor);
    out.push(row);
  }
  return out;
}

export function coveredAngles(item) {
  const slots = new Set();
  for (const take of item?.takes || []) {
    const pose = unwrapTake(take).pose;
    if (pose?.slot) slots.add(pose.slot);
  }
  return ANGLE_SLOTS.filter((s) => slots.has(s));
}

export function missingAngles(item) {
  const have = new Set(coveredAngles(item));
  return ANGLE_SLOTS.filter((s) => !have.has(s));
}

export function nextAngleFor(item) {
  return missingAngles(item)[0] || "front";
}

function takeQuality(seq) {
  const clean = trimSpeech(smooth(seq));
  if (clean.length < 6) return { ok: false, reason: "Too short. Mouth the whole word, then pause." };
  if (clean.length > 180) return { ok: false, reason: "Too long. Mouth only one word or short phrase." };
  const energy = clean.map(motionEnergy);
  const peak = Math.max(...energy);
  const mean = energy.reduce((a, b) => a + b, 0) / energy.length;
  if (peak < 0.18) return { ok: false, reason: "Mouth movement was too small. Open and shape your lips more." };
  if (mean < 0.07) return { ok: false, reason: "Not enough lip motion. Repeat a little slower and clearer." };
  const dyn = dynamicsProfile(clean);
  if (dyn.peakOpen < 0.05 && dyn.travelOpen < 0.08) {
    return { ok: false, reason: "The mouth barely opened. Open and close clearly while you mouth the phrase." };
  }
  if (dyn.travelOpen + dyn.travelWidth < 0.08) {
    return { ok: false, reason: "Lip motion was too still. Move the lips through the whole phrase." };
  }
  const vis = uniqueVisemes(clean);
  if (vis.length < 1) return { ok: false, reason: "Could not see a clear mouth shape. Face the camera." };
  return { ok: true, reason: "", visemes: vis, len: clean.length, dyn };
}

const STRENGTH_LABELS = {
  en: ["Needs retraining", "Started", "Learning", "Trained"],
  ar: ["يحتاج إعادة تدريب", "بدأ", "يتعلم", "مدرب"],
};

export function phraseStrength(item, lang = "en") {
  const n = (item.takes || []).filter((take) => takeDim(takeSeq(take)) >= 9).length;
  const labels = STRENGTH_LABELS[lang] || STRENGTH_LABELS.en;
  const angles = coveredAngles(item).length;
  if (!n) return { label: labels[0], level: 0 };
  if (n >= TARGET_TAKES && angles >= 3) return { label: labels[3], level: 3 };
  if (n >= 4 || angles >= 2) return { label: labels[2], level: 2 };
  return { label: labels[1], level: 1 };
}

function poseGap(a, b) {
  const pa = a || { yaw: 0, pitch: 0, scale: 0.3, slot: "front" };
  const pb = b || { yaw: 0, pitch: 0, scale: 0.3, slot: "front" };
  const gap = Math.hypot(
    (pa.yaw || 0) - (pb.yaw || 0),
    (pa.pitch || 0) - (pb.pitch || 0),
    ((pa.scale || 0.3) - (pb.scale || 0.3)) * 1.4
  );
  if (pa.slot && pa.slot === pb.slot) return Math.max(0, gap - 0.02);
  return gap;
}

export function explainClash(query, other, lang = "en") {
  if (!query || !other) {
    return {
      why: "mouth",
      vis: 1,
      mean: 1,
      dur: 0,
      tip: lang === "ar" ? "بالغ في حركة الشفاه من زاوية جديدة." : "Exaggerate the lip motion from a new angle.",
    };
  }
  const visQ = query.visemes || [];
  const visO = other.visemes || [];
  const vis = visemeScore(visQ, visO);
  const mean = vecDist(query.mean, other.mean, POS_WEIGHTS);
  const dur = durationPenalty(query.len, other.len);
  const dyn = dynamicsDist(query.dyn, other.dyn);
  let why = "mouth";
  if (dyn > 0.22 && (query.dyn?.meanSpeed || 0) !== (other.dyn?.meanSpeed || 0)) why = "timing";
  else if (vis <= 0.22 && mean > 0.12) why = "timing";
  else if (dur > 0.18) why = "length";
  else if (vis > 0.45) why = "shape";
  const tip =
    why === "length"
      ? lang === "ar"
        ? "حرّك شفتيك أبطأ وأوضح للحروف الطويلة."
        : "Stretch the longer sounds. Make this phrase slower and more distinct."
      : why === "timing"
        ? lang === "ar"
          ? "غيّر سرعة فتح الفم عند الحروف الأولى."
          : "Change how fast you open on the first sounds."
        : why === "shape"
          ? lang === "ar"
            ? "بالغ في شكل الفم: ضم أكثر أو ابتسامة أوضح."
            : "Exaggerate the mouth shape: more pucker, smile, or jaw."
          : lang === "ar"
            ? "واجه زاوية مختلفة وبالغ في حركة الشفاه."
            : "Turn to a new angle and exaggerate the lip motion.";
  return { why, vis, mean, dur, tip };
}

export function confusionForTake(seq, text, templates, lang = "en") {
  if (!templates?.length) return null;
  const query = takeStats(seq);
  let best = null;
  for (const item of templates) {
    if (item.text.toLowerCase() === text.toLowerCase() || !item.takes?.length) continue;
    let local = Infinity;
    let localStats = null;
    for (const take of item.takes) {
      const st = takeStats(takeSeq(take));
      const d = scoreAgainstTake(query, st);
      if (d < local) {
        local = d;
        localStats = st;
      }
    }
    if (!best || local < best.score) best = { text: item.text, score: local, stats: localStats };
  }
  if (best && best.score < CLASH_LIMIT) {
    const detail = explainClash(query, best.stats, lang);
    return { text: best.text, score: best.score, ...detail };
  }
  return null;
}

function samePhraseConsistency(seq, item, pose) {
  const takes = item?.takes || [];
  if (takes.length < 2) return { ok: true };
  const slot = pose?.slot;
  const peers = slot
    ? takes.filter((take) => unwrapTake(take).pose?.slot === slot)
    : takes;
  if (peers.length < 2) return { ok: true };
  const query = takeStats(seq);
  const dists = peers.map((take) => scoreAgainstTake(query, takeStats(takeSeq(take))));
  const best = Math.min(...dists);
  if (best > 0.28) {
    return {
      ok: false,
      reason: "This take did not match your earlier lip motion for this phrase. Mouth it the same way, with a clear open and close.",
    };
  }
  return { ok: true };
}

export function addTake(store, text, seq, pose = null, lang = "en") {
  const quality = takeQuality(seq);
  if (!quality.ok) return { ok: false, reason: quality.reason };
  const existing = store.templates.find((t) => t.text.toLowerCase() === text.toLowerCase());
  const consistent = samePhraseConsistency(seq, existing, pose);
  if (!consistent.ok) return { ok: false, reason: consistent.reason };
  const clash = confusionForTake(seq, text, store.templates, lang);
  if (clash) {
    const item = store.templates.find((t) => t.text.toLowerCase() === text.toLowerCase());
    return {
      ok: false,
      clash,
      item,
      visemes: quality.visemes,
      pose,
      nextAngle: nextAngleFor(item),
      angles: coveredAngles(item),
      reason: "clash",
    };
  }
  let item = store.templates.find((t) => t.text.toLowerCase() === text.toLowerCase());
  if (!item) {
    item = { text, takes: [] };
    store.templates.push(item);
  }
  item.takes.push({ seq, pose: pose || { slot: "front" } });
  const cap = TARGET_TAKES * 3;
  if (item.takes.length > cap) item.takes = item.takes.slice(-cap);
  return {
    ok: true,
    clash: null,
    item,
    visemes: quality.visemes,
    pose,
    nextAngle: nextAngleFor(item),
    angles: coveredAngles(item),
  };
}

const LETTER_VISEME = {
  a: "AH", b: "M/B/P", c: "EE", d: "EH", e: "EH", f: "F/V", g: "EH", h: null,
  i: "EE", j: "EH", k: "EH", l: "EH", m: "M/B/P", n: "EH", o: "OH", p: "M/B/P",
  q: "OO/W", r: "EH", s: "EE", t: "EH", u: "OO/W", v: "F/V", w: "OO/W", x: "EE",
  y: "EE", z: "EE",
};

const ARABIC_VISEME = {
  ا: "AH", أ: "AH", إ: "AH", آ: "AH", ء: "AH", ى: "AH", ئ: "AH", ؤ: "AH",
  ع: "AH", غ: "AH",
  و: "OO/W",
  ي: "EE",
  ب: "M/B/P", م: "M/B/P",
  ف: "F/V",
  ه: "EH", ة: "EH", ح: "EH", خ: "EH",
  ت: "EH", ط: "EH", د: "EH", ض: "EH", ن: "EH", ل: "EH", ر: "EH",
  س: "EE", ص: "EE", ز: "EE", ش: "EH", ث: "EH", ذ: "EH", ظ: "EH",
  ك: "EH", ق: "EH", ج: "EH",
};

export function wordToVisemes(word, lang = "en") {
  const out = [];
  if (lang === "ar") {
    const w = String(word).replace(/[^\u0600-\u06FF]/g, "");
    for (const ch of w) {
      const v = ARABIC_VISEME[ch] || null;
      if (v && out[out.length - 1] !== v) out.push(v);
    }
    return out;
  }
  const w = String(word).toLowerCase().replace(/[^a-z]/g, "");
  let i = 0;
  while (i < w.length) {
    const two = w.slice(i, i + 2);
    let v = null;
    if (two === "th" || two === "sh" || two === "ch" || two === "ph" || two === "ck") {
      v = "EH";
      i += 2;
    } else {
      v = LETTER_VISEME[w[i]] || null;
      i += 1;
    }
    if (v && out[out.length - 1] !== v) out.push(v);
  }
  return out;
}

function textSignature(text, lang = "en") {
  return wordToVisemes(text, lang).join("|") || text.toLowerCase();
}

function robustTrainedScore(item, query, queryPose) {
  const dists = [];
  for (const take of item.takes) {
    const seq = takeSeq(take);
    const gap = poseGap(queryPose, unwrapTake(take).pose);
    const poseCost = Math.min(0.04, gap * 0.006);
    for (const tempo of MATCH_TEMPO) {
      const src = tempo === 1 ? seq : stretchSeq(seq, tempo);
      dists.push(scoreAgainstTake(query, takeStats(src)) + poseCost);
    }
  }
  if (!dists.length) return Infinity;
  dists.sort((a, b) => a - b);
  const keep = Math.min(3, Math.max(1, Math.ceil(item.takes.length * 0.35)));
  let sum = 0;
  for (let i = 0; i < keep; i++) sum += dists[i];
  let robust = sum / keep;
  const proto = prototypeTakes(item.takes);
  if (proto) {
    const protoScore = dtw(query.prepared, proto, WEIGHTS);
    if (Number.isFinite(protoScore)) robust = Math.min(robust, protoScore * 0.92 + robust * 0.08);
  }
  return robust;
}

function matchConfidence(distance, takes) {
  const scale = 0.09 + Math.min(0.03, Math.max(0, takes - 1) * 0.004);
  const boost = Math.min(0.12, Math.max(0, takes - 1) * 0.015);
  return clamp01(Math.exp(-distance / scale) + boost);
}

export function matchSequence(seq, templates, sensitivity = 0.85, recent = [], lang = "en", pose = null) {
  const ready = (templates || []).filter((t) => (t.takes || []).length);
  if (!ready.length) return [];
  const query = takeStats(seq);
  if (query.len < 5) return [];
  const maxRaw = 0.095 + (1.2 - Math.min(1.2, Math.max(0.45, sensitivity))) * 0.08;
  const scored = [];
  for (const item of ready) {
    const take0 = takeStats(takeSeq(item.takes[0]));
    const vis = visemeScore(query.visemes, take0.visemes);
    if (query.visemes.length && take0.visemes.length && vis > 0.82) continue;
    const raw = robustTrainedScore(item, query, pose);
    if (!Number.isFinite(raw)) continue;
    scored.push({
      text: item.text,
      distance: raw,
      vis,
      lengthDiff: Math.abs(query.len - take0.len),
      source: "trained",
      takes: item.takes.length,
      key: textSignature(item.text, lang),
    });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => a.distance - b.distance || a.vis - b.vis || b.takes - a.takes);
  const seen = new Set();
  const ranked = [];
  for (const c of scored) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    ranked.push(c);
  }
  const best = ranked[0];
  if (!best || best.distance > maxRaw) return [];
  const second = ranked[1];
  const margin = second ? second.distance - best.distance : 1;
  const ambiguous = Boolean(second && margin < 0.012 && second.distance <= maxRaw);
  return ranked.slice(0, 4).map((c, i) => ({
    text: c.text,
    source: c.source,
    takes: c.takes,
    confidence: matchConfidence(c.distance, c.takes),
    ambiguous: i === 0 ? ambiguous : false,
  }));
}

function takeDim(seq) {
  return seq?.[0]?.length || 0;
}

function emptyPack() {
  return { templates: [], log: [] };
}

function mergePack(a, b) {
  const out = { templates: [...(a?.templates || [])], log: [...(a?.log || [])] };
  for (const item of b?.templates || []) {
    const existing = out.templates.find((t) => t.text.toLowerCase() === item.text.toLowerCase());
    if (existing) existing.takes = [...(existing.takes || []), ...(item.takes || [])];
    else out.templates.push(item);
  }
  out.log = [...out.log, ...(b?.log || [])].slice(-80);
  return out;
}

function cleanPack(pack) {
  const templates = (pack?.templates || [])
    .map((item) => ({
      ...item,
      takes: (item.takes || [])
        .map((take) => {
          if (Array.isArray(take)) return { seq: take, pose: { slot: "front" } };
          if (take?.seq) return take;
          return null;
        })
        .filter((take) => take && takeDim(take.seq) >= FEATURE_DIM),
    }))
    .filter((item) => item.text && item.takes.length);
  return { templates, log: pack?.log || [] };
}

export function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    let en = cleanPack(raw.languages?.en || { templates: raw.templates || [], log: raw.log || [] });
    let ar = cleanPack(raw.languages?.ar || emptyPack());
    if (raw.personal && typeof raw.personal === "object") {
      for (const id of Object.keys(raw.personal)) {
        en = mergePack(en, cleanPack(raw.personal[id]?.en));
        ar = mergePack(ar, cleanPack(raw.personal[id]?.ar));
      }
    }
    return {
      lang: raw.lang === "ar" ? "ar" : "en",
      version: STORE_VERSION,
      languages: { en, ar },
    };
  } catch {
    return {
      lang: "en",
      version: STORE_VERSION,
      languages: { en: emptyPack(), ar: emptyPack() },
    };
  }
}

export function packFor(store, lang) {
  const key = lang === "ar" ? "ar" : "en";
  if (!store.languages) store.languages = { en: emptyPack(), ar: emptyPack() };
  if (!store.languages[key]) store.languages[key] = emptyPack();
  return store.languages[key];
}

export function saveStore(store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export async function createLandmarker() {
  const files = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );
  const options = {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
  };
  try {
    return await FaceLandmarker.createFromOptions(files, options);
  } catch {
    options.baseOptions.delegate = "CPU";
    return FaceLandmarker.createFromOptions(files, options);
  }
}

export function drawLips(ctx, landmarks, w, h, speaking) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks) return;
  ctx.save();
  ctx.strokeStyle = speaking ? "#e8a87c" : "#7ec8c0";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  LIP_OUTER.forEach((idx, i) => {
    const p = landmarks[idx];
    const x = p.x * w;
    const y = p.y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  LIP_INNER.forEach((idx, i) => {
    const p = landmarks[idx];
    const x = p.x * w;
    const y = p.y * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export { LIP_OUTER, LIP_INNER };
