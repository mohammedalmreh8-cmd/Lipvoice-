import {
  TARGET_TAKES,
  createLandmarker,
  drawLips,
  extractFeatures,
  visemeFromFeatures,
  createSpeechDetector,
  loadStore,
  saveStore,
  matchSequence,
  addTake,
  phraseStrength,
  faceQuality,
  trainFaceQuality,
  facePose,
  coveredAngles,
  nextAngleFor,
  essentialsFor,
  packFor,
} from "./engine.js";
import { UI } from "./i18n.js";
import { buildPronunciation, articAt, segmentAt, mouthPath } from "./pronounce.js";
import {
  loadDonor,
  saveDonor,
  listVoiceProfiles,
  applyVoiceProfile,
  deleteVoiceProfile,
  getAppliedId,
  pickRecorderMime,
  getTTSSettings,
  saveTTSSettings,
  getUseCustomVoice,
  setUseCustomVoice,
} from "./voices.js";
import { buildDonor } from "./clone.js";
import { generateSpeech, testRemote, remoteReady, fetchArabicNeural, arabicTtsUrl } from "./tts.js";
import { decodeToMono, samplesToBuffer, encodeWav } from "./audio.js";
import * as cloud from "./cloud.js";

const video = document.getElementById("camera");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const gate = document.getElementById("gate");
const predictionEl = document.getElementById("prediction");
const candidatesEl = document.getElementById("candidates");
const statusText = document.getElementById("status-text");
const statusDot = document.getElementById("status-dot");
const faceBadge = document.getElementById("face-badge");
const meter = document.querySelector("#mouth-meter span");
const phraseGrid = document.getElementById("phrase-grid");
const logEl = document.getElementById("log");
const speakBtn = document.getElementById("btn-speak");
const trainedList = document.getElementById("trained-list");
const trainHint = document.getElementById("train-hint");
const trainText = document.getElementById("train-text");
const recordBtn = document.getElementById("btn-record");
const voiceSelect = document.getElementById("opt-voice");
const trainProgress = document.getElementById("train-progress");
const angleChips = document.getElementById("angle-chips");
const trainCoach = document.getElementById("train-coach");
const confidenceEl = document.getElementById("confidence");
const visemeStrip = document.getElementById("viseme-strip");
const pgOuter = document.getElementById("pg-outer");
const pgInner = document.getElementById("pg-inner");
const pgTeeth = document.getElementById("pg-teeth");
const pgCurrent = document.getElementById("pg-current");
const pgWords = document.getElementById("pg-words");
const pgPhones = document.getElementById("pg-phones");
const pgProgress = document.getElementById("pg-progress");
const pgHint = document.getElementById("pg-hint");
const pgPlay = document.getElementById("pg-play");
const pgPause = document.getElementById("pg-pause");
const pgReplay = document.getElementById("pg-replay");
const pgSlow = document.getElementById("pg-slow");
const pgAccent = document.getElementById("pg-accent");

const settings = {
  autospeak: true,
  sensitivity: 0.72,
  pause: 700,
};

const voiceBtn = document.getElementById("btn-voice");
const voiceFile = document.getElementById("voice-file");
const voicePreviewBtn = document.getElementById("btn-voice-preview");
const voiceHint = document.getElementById("voice-hint");
const voiceAppliedEl = document.getElementById("voice-applied");
const voiceListEl = document.getElementById("voice-list");
const voiceTestText = document.getElementById("voice-test-text");
const voiceTestBtn = document.getElementById("btn-voice-test");
const voiceHearOriginalBtn = document.getElementById("btn-voice-hear-original");
const voiceHearCleanBtn = document.getElementById("btn-voice-hear-clean");
const voiceQualityEl = document.getElementById("voice-quality");
const ttsEnabled = document.getElementById("opt-tts-enabled");
const ttsUrl = document.getElementById("opt-tts-url");
const ttsKey = document.getElementById("opt-tts-key");
const ttsVoiceName = document.getElementById("opt-tts-voice");
const ttsSaveBtn = document.getElementById("btn-tts-save");
const ttsTestBtn = document.getElementById("btn-tts-test");
const useCustomEl = document.getElementById("opt-use-custom");
const modeCustomBtn = document.getElementById("btn-mode-custom");
const modeAiBtn = document.getElementById("btn-mode-ai");
const voiceModeHint = document.getElementById("voice-mode-hint");
const arAiBtn = document.getElementById("btn-ar-ai");
const voiceHearGeneratedBtn = document.getElementById("btn-voice-hear-generated");
const voiceDiagEl = document.getElementById("voice-diag");
let voiceProfiles = [];
let pendingVoice = null;
let donorModel = null;
let donorId = null;
let referenceBlob = null;
let voiceRecorder = null;
let voiceChunks = [];
let voiceStream = null;
let voicePlayback = null;
let voiceNode = null;
let playToken = 0;
let lastProvider = "";
let lastWavBlob = null;
let lastDiag = null;
let audioCtx = null;
let audioUnlocked = false;

let landmarker = null;
let running = false;
let lastVideoTime = -1;
let buffer = [];
let capturing = false;
let currentText = "";
let lastUtterance = null;
let cooldownUntil = 0;
let store = loadStore();
const detector = createSpeechDetector();

// ---- cloud / account state -------------------------------------------------
let userId = null;
let cloudProfileRole = "user";
let syncing = false;

function t() {
  return UI[store.lang] || UI.en;
}

function pack() {
  return packFor(store, store.lang);
}

// ============================================================ cloud / sync
// These functions bridge the in-memory store used by the recognition engine
// and the Supabase backend. When no account is signed in (or cloud is not
// configured) every call is a no-op and the app keeps its on-device behaviour.

function cloudReady() {
  return cloud.cloudEnabled && Boolean(userId);
}

function setSyncStatus(textKey) {
  const el = document.getElementById("sync-status");
  if (el && textKey) el.textContent = t()[textKey] || textKey;
}

function refreshUiAfterSync() {
  renderTrained();
  renderPhrases();
  renderLog();
  refreshVoiceProfiles();
}

// Pull the signed-in user's training, settings and voice profiles into the
// in-memory store, then persist the merged result to the local cache.
async function pullCloud() {
  if (!cloudReady()) return;
  syncing = true;
  setSyncStatus("syncPulling");
  try {
    for (const lang of ["en", "ar"]) {
      const p = await cloud.fetchPack(userId, lang);
      store.languages[lang] = { templates: p.templates, log: [] };
    }
    const s = await cloud.fetchSettings(userId);
    if (s) applyCloudSettings(s);
    saveStore(store);
    refreshUiAfterSync();
    setSyncStatus("syncDone");
  } catch (err) {
    console.warn("pullCloud failed", err);
    setSyncStatus("syncFail");
  } finally {
    syncing = false;
  }
}

function applyCloudSettings(s) {
  if (typeof s.autospeak === "boolean") settings.autospeak = s.autospeak;
  if (typeof s.use_custom_voice === "boolean") setUseCustomVoice(s.use_custom_voice);
  if (typeof s.sensitivity === "number") settings.sensitivity = s.sensitivity;
  if (typeof s.pause_ms === "number") settings.pause = s.pause_ms;
  if (s.tts && typeof s.tts === "object") {
    try { saveTTSSettings(s.tts); } catch { /* local store may be unavailable */ }
  }
  const autoEl = document.getElementById("opt-autospeak");
  if (autoEl) autoEl.checked = !!settings.autospeak;
  if (useCustomEl) useCustomEl.checked = getUseCustomVoice();
}

function snapshotSettings() {
  return {
    autospeak: !!settings.autospeak,
    sensitivity: settings.sensitivity,
    pause_ms: settings.pause,
    use_custom_voice: getUseCustomVoice(),
    tts: getTTSSettings(),
  };
}

async function pushSettings() {
  if (!cloudReady()) return;
  try { await cloud.saveSettings(userId, snapshotSettings()); }
  catch (err) { console.warn("pushSettings failed", err); }
}

// Push one newly-trained take to the account. Used at every take-commit site.
async function pushTake(text, seq, pose, quality) {
  if (!cloudReady()) return;
  try {
    setSyncStatus("syncPushing");
    const phraseId = await cloud.upsertPersonalPhrase(userId, store.lang, text);
    await cloud.addTake(userId, phraseId, seq, pose, quality);
    await cloud.logEvent(userId, phraseId, "take_added", { lang: store.lang });
    const tpl = pack().templates.find((x) => x.text === text);
    if (tpl) tpl.id = phraseId;
    setSyncStatus("syncDone");
  } catch (err) {
    console.warn("pushTake failed", err);
    setSyncStatus("syncFail");
  }
}

async function pushDeletePhrase(text) {
  if (!cloudReady()) return;
  try {
    const tpl = pack().templates.find((x) => x.text.toLowerCase() === String(text).toLowerCase());
    if (tpl?.id) await cloud.deletePhrase(userId, tpl.id);
    else {
      // Fall back to a text lookup when the local id is unknown.
      const packets = await cloud.fetchPack(userId, store.lang);
      const match = packets.templates.find((x) => x.text.toLowerCase() === String(text).toLowerCase());
      if (match?.id) await cloud.deletePhrase(userId, match.id);
    }
  } catch (err) { console.warn("pushDeletePhrase failed", err); }
}

// One-time migration: if the user trained on this device before signing in,
// upload that local training so it is not lost.
async function migrateLocalIfNeeded() {
  if (!cloudReady()) return;
  const flag = `lipvoice-migrated:${userId}`;
  if (localStorage.getItem(flag)) return;
  const remote = await cloud.fetchPack(userId, "en");
  const hasLocal = ["en", "ar"].some((l) => (store.languages[l]?.templates || []).length);
  if (hasLocal && remote.templates.length === 0) {
    for (const lang of ["en", "ar"]) {
      const templates = store.languages[lang]?.templates || [];
      for (const tpl of templates) {
        try {
          const phraseId = await cloud.upsertPersonalPhrase(userId, lang, tpl.text);
          for (const take of tpl.takes || []) {
            await cloud.addTake(userId, phraseId, take.seq, take.pose, null);
          }
        } catch (err) { console.warn("migrate failed for", tpl.text, err); }
      }
    }
  }
  localStorage.setItem(flag, "1");
}

function setSignedInView(session) {
  userId = session?.user?.id || null;
  if (!userId) cloudProfileRole = "user";
  const auth = document.getElementById("cloud-auth");
  const acct = document.getElementById("cloud-account");
  const offline = document.getElementById("cloud-offline");
  const btnCloud = document.getElementById("btn-cloud");
  if (!cloud.cloudEnabled) {
    offline?.classList.remove("hidden");
    auth?.classList.add("hidden");
    acct?.classList.add("hidden");
    if (btnCloud) btnCloud.classList.add("hidden");
    return;
  }
  auth?.classList.toggle("hidden", Boolean(userId));
  acct?.classList.toggle("hidden", !userId);
  offline?.classList.add("hidden");
  if (btnCloud) btnCloud.textContent = userId ? (session.user.email || t().sharedTraining) : t().signIn;
  if (userId) {
    const who = document.getElementById("account-who");
    if (who) who.textContent = t().accountReady;
    setSyncStatus("syncDone");
  }
}

async function onSignedIn(session) {
  setSignedInView(session);
  if (!session?.user) return;
  try {
    const prof = await cloud.fetchProfile(userId);
    cloudProfileRole = prof?.role === "moderator" ? "moderator" : "user";
  } catch (err) { cloudProfileRole = "user"; console.warn("fetchProfile failed", err); }
  await migrateLocalIfNeeded();
  await pullCloud();
  await loadCloudVoiceProfiles();
}

async function loadCloudVoiceProfiles() {
  if (!cloudReady()) return;
  try {
    const list = await cloud.listVoiceProfiles(userId);
    const applied = list.find((p) => p.is_applied) || list[0];
    if (applied?.storage_path) {
      const blob = await cloud.loadVoiceBlob(applied.storage_path);
      await saveDonor(blob);
      refreshVoiceProfiles();
    }
  } catch (err) { console.warn("loadCloudVoiceProfiles failed", err); }
}

// Upload a freshly-recorded voice sample so the custom voice follows the
// account across devices. Degrades silently when offline or unconfigured.
async function pushVoiceProfileToCloud(blob, name) {
  if (!cloudReady()) return null;
  try {
    setSyncStatus("syncPushing");
    const rec = await cloud.saveVoiceProfile(userId, name || "voice", blob, null);
    setSyncStatus("syncDone");
    return rec;
  } catch (err) {
    console.warn("pushVoiceProfileToCloud failed", err);
    setSyncStatus("syncFail");
    return null;
  }
}

// Remove account copies of a voice profile by display name (local ids and
// cloud ids are independent).
async function deleteCloudVoiceByName(name) {
  if (!cloudReady() || !name) return;
  try {
    const list = await cloud.listVoiceProfiles(userId);
    const matches = list.filter((p) => p.name === name);
    for (const m of matches) await cloud.deleteVoiceProfile(userId, m.id);
  } catch (err) { console.warn("deleteCloudVoiceByName failed", err); }
}


let recordMode = null;
let recordBuf = [];
let recordPoses = [];
let livePose = null;
let liveTick = 0;
let captureStarted = 0;
let stableLive = { text: "", count: 0 };

const ANGLE_KEYS = {
  front: "angleFront",
  left: "angleLeft",
  right: "angleRight",
  near: "angleNear",
  far: "angleFar",
};

const POSE_HINTS = {
  front: "poseFront",
  left: "poseLeft",
  right: "poseRight",
  near: "poseNear",
  far: "poseFar",
};

const MIX_KEYS = {
  shape: "mixShape",
  timing: "mixTiming",
  length: "mixLength",
  mouth: "mixMouth",
};

function angleLabel(slot) {
  return t()[ANGLE_KEYS[slot] || "angleFront"];
}

function poseHint(slot) {
  return t()[POSE_HINTS[slot] || "poseFront"];
}

function mixText(why) {
  return t()[MIX_KEYS[why] || "mixMouth"];
}

function clashMessage(result) {
  if (!result?.clash) return "";
  const ui = t();
  const other = result.clash.text;
  const tip = result.clash.tip || mixText(result.clash.why);
  return `${ui.clashSaved} “${other}”. ${mixText(result.clash.why)} ${tip} ${ui.tryAgain}`;
}

function findItem(text) {
  if (!text) return null;
  return pack().templates.find((item) => item.text.toLowerCase() === text.toLowerCase()) || null;
}

function renderAngles(item, nextSlot) {
  if (!angleChips) return;
  const have = new Set(coveredAngles(item));
  const next = nextSlot || nextAngleFor(item);
  angleChips.innerHTML = "";
  ["front", "left", "right", "near", "far"].forEach((slot) => {
    const chip = document.createElement("span");
    chip.className = "angle-chip";
    if (have.has(slot)) chip.classList.add("have");
    if (slot === next && !have.has(slot)) chip.classList.add("next");
    chip.textContent = angleLabel(slot);
    angleChips.appendChild(chip);
  });
}

function setCoach(text) {
  if (trainCoach) trainCoach.textContent = text || "";
}

const pronounce = {
  guide: null,
  playing: false,
  slow: false,
  t: 0,
  last: 0,
  raf: 0,
};

function drawMouth(artic) {
  if (!pgOuter || !pgInner) return;
  const paths = mouthPath(artic);
  pgOuter.setAttribute("d", paths.outer);
  pgInner.setAttribute("d", paths.inner);
  if (pgTeeth) pgTeeth.classList.toggle("show", !!paths.teeth);
}

function highlightGuide(ms) {
  const seg = segmentAt(pronounce.guide, ms);
  if (pgCurrent) {
    if (!pronounce.guide?.words?.length) pgCurrent.textContent = "";
    else pgCurrent.textContent = seg?.word || t().pgEmpty;
  }
  if (pgWords) {
    [...pgWords.children].forEach((el, i) => {
      el.classList.toggle("on", seg?.wordIndex === i);
    });
  }
  if (pgPhones) {
    [...pgPhones.children].forEach((el) => {
      el.classList.toggle("on", el.dataset.t0 === String(seg?.t0));
    });
  }
  if (pgProgress && pronounce.guide?.duration) {
    pgProgress.style.width = `${Math.min(100, (ms / pronounce.guide.duration) * 100)}%`;
  }
}

function renderGuideFrame(ms) {
  if (!pronounce.guide) {
    drawMouth({ open: 0.08, round: 0.1, spread: 0.2, close: 0.7, press: 0.1, jaw: 0.05, viseme: "REST" });
    highlightGuide(0);
    return;
  }
  drawMouth(articAt(pronounce.guide, ms));
  highlightGuide(ms);
}

function stopGuide() {
  pronounce.playing = false;
  if (pronounce.raf) cancelAnimationFrame(pronounce.raf);
  pronounce.raf = 0;
}

function tickGuide(now) {
  if (!pronounce.playing || !pronounce.guide) return;
  const rate = pronounce.slow ? 0.45 : 1;
  pronounce.t += now - pronounce.last;
  pronounce.last = now;
  const ms = pronounce.t * rate;
  if (ms >= pronounce.guide.duration) {
    renderGuideFrame(pronounce.guide.duration);
    stopGuide();
    return;
  }
  renderGuideFrame(ms);
  pronounce.raf = requestAnimationFrame(tickGuide);
}

function playGuide(fromStart = false) {
  if (!pronounce.guide?.duration) return;
  const shown = pronounce.t * (pronounce.slow ? 0.45 : 1);
  if (fromStart || shown >= pronounce.guide.duration) pronounce.t = 0;
  pronounce.playing = true;
  pronounce.last = performance.now();
  if (pronounce.raf) cancelAnimationFrame(pronounce.raf);
  pronounce.raf = requestAnimationFrame(tickGuide);
}

function rebuildGuide() {
  const text = trainText?.value?.trim() || "";
  const accent = pgAccent?.value || "us";
  pronounce.guide = text ? buildPronunciation(text, store.lang, accent) : null;
  pronounce.t = 0;
  stopGuide();
  if (pgWords) {
    pgWords.innerHTML = "";
    (pronounce.guide?.words || []).forEach((word) => {
      const chip = document.createElement("span");
      chip.className = "pg-chip";
      chip.textContent = word;
      pgWords.appendChild(chip);
    });
  }
  if (pgPhones) {
    pgPhones.innerHTML = "";
    (pronounce.guide?.segments || [])
      .filter((s) => s.phone && s.phone !== "REST")
      .forEach((s) => {
        const chip = document.createElement("span");
        chip.className = "pg-chip";
        chip.dataset.t0 = String(s.t0);
        chip.textContent = s.phone;
        pgPhones.appendChild(chip);
      });
  }
  if (pgHint) pgHint.textContent = text ? t().pgHint : t().pgEmpty;
  if (pgProgress) pgProgress.style.width = "0";
  if (pgAccent) pgAccent.closest(".pg-accent")?.classList.toggle("hidden", store.lang === "ar");
  renderGuideFrame(0);
  if (text) playGuide(true);
}

function setStatus(mode, text) {
  statusDot.className = `dot ${mode}`;
  statusText.textContent = text;
}

function stopVoicePlayback() {
  if (voiceNode) {
    try {
      voiceNode.stop();
    } catch {
      /* already stopped */
    }
    voiceNode.disconnect?.();
    voiceNode = null;
  }
  if (voicePlayback) {
    try {
      voicePlayback.pause();
    } catch {
      /* already paused */
    }
    if (voicePlayback !== arabicPlayer) {
      voicePlayback.removeAttribute("src");
      voicePlayback.load();
    }
    voicePlayback = null;
  }
  window.speechSynthesis.cancel();
}

async function unlockAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error("no-audio");
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (!audioUnlocked && audioCtx.state === "running") {
    const silent = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const src = audioCtx.createBufferSource();
    src.buffer = silent;
    src.connect(audioCtx.destination);
    src.start(0);
    audioUnlocked = true;
  }
  return audioCtx.state === "running";
}

document.addEventListener("pointerdown", () => {
  unlockAudio().catch(() => {});
  const player = ensureArabicPlayer();
  if (!player.dataset.unlocked) {
    player.src = arabicTtsUrl("نعم");
    player.muted = true;
    player.play().then(() => {
      player.pause();
      player.muted = false;
      player.dataset.unlocked = "1";
    }).catch(() => {
      player.muted = false;
    });
  }
}, { passive: true });

function reportVoiceError(err, target) {
  const ui = t();
  const msg = String(err?.message || err || "");
  let text = ui.voiceFail;
  if (msg === "no-voice") text = ui.voiceNeedApply;
  else if (msg === "locked" || msg === "no-audio") text = ui.voiceNeedGesture;
  else if (msg === "bad-file" || msg === "too-quiet") text = ui.voiceBadFile;
  else if (msg.startsWith("remote")) text = ui.voiceRemoteFail;
  else if (msg.startsWith("synth")) text = ui.voiceSynthFail;
  if (target !== false && voiceHint) voiceHint.textContent = text;
  setStatus("idle", text);
}

async function ensureDonor() {
  const appliedId = getAppliedId();
  if (donorModel && donorId === appliedId) return donorModel;
  const blob = await loadDonor();
  if (!blob) throw new Error("no-voice");
  const ready = await unlockAudio();
  if (!ready || !audioCtx) throw new Error("locked");
  let donor;
  try {
    donor = await buildDonor(blob, audioCtx);
  } catch (err) {
    throw new Error(String(err?.message) === "too-quiet" ? "too-quiet" : "bad-file");
  }
  donorModel = donor;
  donorId = appliedId || getAppliedId();
  referenceBlob = blob;
  return donorModel;
}

function playBufferOnce(buffer) {
  return new Promise((resolve, reject) => {
    stopVoicePlayback();
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = false;
    src.connect(audioCtx.destination);
    const ms = (buffer.duration || 0) * 1000 + 200;
    let done = false;
    let timer = 0;
    const finish = (ok, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        src.disconnect();
      } catch {
        /* already detached */
      }
      if (voiceNode === src) voiceNode = null;
      if (ok) resolve(true);
      else reject(err || new Error("play-fail"));
    };
    timer = setTimeout(() => {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
      finish(true);
    }, ms);
    src.onended = () => finish(true);
    src.onerror = () => finish(false, new Error("play-fail"));
    voiceNode = src;
    try {
      src.start(0);
    } catch (err) {
      finish(false, err);
    }
  });
}

function showDiag(diag, extra) {
  lastDiag = diag || lastDiag;
  if (!voiceDiagEl) return;
  const d = lastDiag || {};
  const lines = [
    extra || (d.ok === false ? t().voiceGenFail : t().voiceGenOk),
    `engine: ${d.engine || lastProvider || "none"}`,
    `format: ${d.format || "pcm-f32-mono"}`,
    `sampleRate: ${d.sampleRate || d.sr || "—"}`,
    `channels: ${d.channels || 1}`,
    `duration: ${typeof d.duration === "number" ? d.duration.toFixed(2) + "s" : "—"}`,
    d.peak != null ? `peak: ${Number(d.peak).toFixed(3)}` : null,
    d.rms != null ? `rms: ${Number(d.rms).toFixed(4)}` : null,
    d.zcr != null ? `zcr: ${Number(d.zcr).toFixed(3)}` : null,
    d.f0 != null ? `f0: ${Math.round(d.f0)} Hz` : null,
    d.text ? `text: ${d.text}` : null,
    d.error ? `error: ${d.error}` : null,
  ].filter(Boolean);
  voiceDiagEl.textContent = lines.join("\n");
}

async function playGeneratedWav() {
  if (!lastWavBlob) throw new Error("no-audio");
  await unlockAudio();
  stopVoicePlayback();
  const url = URL.createObjectURL(lastWavBlob);
  const audio = new Audio();
  audio.preload = "auto";
  audio.loop = false;
  audio.src = url;
  voicePlayback = audio;
  await new Promise((resolve, reject) => {
    const done = (ok, err) => {
      audio.onended = null;
      audio.onerror = null;
      URL.revokeObjectURL(url);
      if (voicePlayback === audio) voicePlayback = null;
      if (ok) resolve(true);
      else reject(err || new Error("play-fail"));
    };
    audio.onended = () => done(true);
    audio.onerror = () => done(false, new Error("play-fail"));
    audio.play().catch((err) => done(false, err));
  });
}

async function speakCloned(phrase) {
  if (!phrase) throw new Error("no-text");
  const donor = await ensureDonor();
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (audioCtx.state !== "running") throw new Error("locked");
  let result;
  try {
    result = await generateSpeech({
      text: phrase,
      lang: store.lang,
      ctx: audioCtx,
      donor,
    });
  } catch (err) {
    showDiag({
      engine: lastProvider || "ondevice",
      format: "none",
      sampleRate: 22050,
      channels: 1,
      duration: 0,
      text: phrase,
      ok: false,
      error: String(err?.message || err),
    });
    throw err;
  }
  lastProvider = result.provider;
  if (result.samples && result.sr) {
    lastWavBlob = encodeWav(result.samples, result.sr);
  } else {
    lastWavBlob = null;
  }
  showDiag({ ...(result.diag || {}), engine: result.diag?.engine || result.provider, ok: true });
  if (voiceHearGeneratedBtn) voiceHearGeneratedBtn.disabled = !lastWavBlob;
  await playBufferOnce(result.buffer);
  return result.provider;
}

let arabicPlayer = document.getElementById("arabic-player") || null;

function ensureArabicPlayer() {
  if (arabicPlayer) return arabicPlayer;
  arabicPlayer = document.getElementById("arabic-player");
  if (!arabicPlayer) {
    arabicPlayer = new Audio();
    arabicPlayer.id = "arabic-player";
    arabicPlayer.preload = "auto";
    arabicPlayer.setAttribute("playsinline", "");
    document.body.appendChild(arabicPlayer);
  }
  arabicPlayer.playsInline = true;
  arabicPlayer.volume = 1;
  return arabicPlayer;
}

function playArabicUrl(phrase) {
  const audio = ensureArabicPlayer();
  if (voiceNode) {
    try {
      voiceNode.stop();
    } catch {
      /* already stopped */
    }
    voiceNode.disconnect?.();
    voiceNode = null;
  }
  window.speechSynthesis?.cancel?.();
  try {
    audio.pause();
  } catch {
    /* already paused */
  }
  audio.muted = false;
  audio.volume = 1;
  audio.src = arabicTtsUrl(phrase) + "&t=" + Date.now();
  voicePlayback = audio;
  const playing = audio.play();
  return new Promise((resolve, reject) => {
    const done = (ok, err) => {
      audio.onended = null;
      audio.onerror = null;
      if (ok) resolve("arabic-neural");
      else reject(err || new Error("play-fail"));
    };
    audio.onended = () => done(true);
    audio.onerror = () => done(false, new Error("play-fail"));
    if (playing && playing.then) playing.catch((err) => done(false, err));
  });
}

async function speakArabicNeural(phrase) {
  lastProvider = "arabic-neural";
  showDiag({ engine: "arabic-neural", format: "mp3", text: phrase, ok: true });
  try {
    return await playArabicUrl(phrase);
  } catch {
    await unlockAudio().catch(() => {});
    const neural = await fetchArabicNeural(phrase, audioCtx);
    if (neural.buffer && audioCtx?.state === "running") {
      await playBufferOnce(neural.buffer);
      return "arabic-neural";
    }
    throw new Error("play-fail");
  }
}

async function speakOnDevice(phrase) {
  const ready = await unlockAudio().catch(() => false);
  if (store.lang === "ar") return speakArabicNeural(phrase);
  if (!ready || !audioCtx) throw new Error("locked");
  const result = await generateSpeech({
    text: phrase,
    lang: store.lang,
    ctx: audioCtx,
    donor: null,
    allowRemote: false,
  });
  lastProvider = result.provider || "ondevice";
  if (result.samples && result.sr) lastWavBlob = encodeWav(result.samples, result.sr);
  else lastWavBlob = null;
  showDiag({ ...(result.diag || {}), engine: result.diag?.engine || lastProvider, ok: true });
  if (voiceHearGeneratedBtn) voiceHearGeneratedBtn.disabled = !lastWavBlob;
  await playBufferOnce(result.buffer);
  return lastProvider;
}

function isArabicVoice(voice) {
  return !!(voice && arabicVoiceScore(voice) > 0);
}

function pickRobotVoice() {
  const voices = speechSynthesis.getVoices() || [];
  const chosen = voiceSelect?.value;
  if (chosen) {
    const match = voices.find((v) => v.name === chosen);
    if (match && (store.lang !== "ar" || isArabicVoice(match))) return match;
  }
  const langVoices = voicesForLang();
  return langVoices[0] || null;
}

function speakRobot(phrase) {
  return new Promise((resolve, reject) => {
    if (store.lang === "ar") {
      speakOnDevice(phrase).then(resolve).catch(reject);
      return;
    }
    if (!window.speechSynthesis) {
      reject(new Error("no-audio"));
      return;
    }
    stopVoicePlayback();
    const voice = pickRobotVoice();
    const u = new SpeechSynthesisUtterance(phrase);
    u.lang = voice?.lang || t().speakLang;
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => resolve("robot");
    u.onerror = () => reject(new Error("play-fail"));
    speechSynthesis.speak(u);
  });
}

async function speak(text) {
  const phrase = text || currentText;
  if (!phrase || !isUsablePrediction(phrase)) return;
  const useCustom = getUseCustomVoice();
  try {
    if (store.lang === "ar" && !useCustom) {
      const provider = await speakArabicNeural(phrase);
      setStatus("live", t().voicePlayingOnDevice);
      lastProvider = provider;
      return;
    }
    if (!useCustom) {
      lastProvider = "robot";
      const provider = await speakRobot(phrase);
      setStatus("live", t().voicePlayingRobot);
      return;
    }
    const provider = await speakCloned(phrase);
    setStatus("live", provider === "remote" ? t().voicePlayingRemote : t().voicePlaying);
  } catch (err) {
    if (store.lang === "ar") {
      try {
        await speakArabicNeural(phrase);
        setStatus("live", t().voicePlayingOnDevice);
        return;
      } catch {
        /* fall through */
      }
    }
    reportVoiceError(err, false);
  }
}

function appliedProfile() {
  const id = getAppliedId();
  return voiceProfiles.find((item) => item.id === id) || null;
}

function setVoiceButtons() {
  const ui = t();
  if (voiceBtn) voiceBtn.textContent = voiceRecorder ? ui.stopVoice : ui.recordVoice;
  const hasVoice = !!(pendingVoice || getAppliedId() || voiceProfiles.length);
  if (voicePreviewBtn) voicePreviewBtn.disabled = store.lang === "ar" ? false : (!hasVoice && getUseCustomVoice());
  if (voiceTestBtn) voiceTestBtn.disabled = store.lang === "ar" ? false : (!hasVoice && getUseCustomVoice());
  if (voiceHearOriginalBtn) voiceHearOriginalBtn.disabled = !hasVoice;
  if (voiceHearCleanBtn) voiceHearCleanBtn.disabled = !hasVoice;
  if (voiceHearGeneratedBtn) voiceHearGeneratedBtn.disabled = !lastWavBlob;
}

function qualityText(rating) {
  const ui = t();
  if (!rating) return "";
  const label = rating.level === "bad" ? ui.qualityBad : rating.level === "warn" ? ui.qualityWarn : ui.qualityGood;
  const parts = (rating.reasons || []).map((r) => (ui.qualityReasons && ui.qualityReasons[r]) || r);
  return parts.length ? `${label}: ${parts.join(" · ")}` : label;
}

function showQuality() {
  if (!voiceQualityEl) return;
  const rating = donorModel?.rating;
  if (!rating) {
    voiceQualityEl.textContent = "";
    voiceQualityEl.className = "hint";
    return;
  }
  voiceQualityEl.textContent = qualityText(rating);
  voiceQualityEl.className = `hint quality-${rating.level}`;
}

async function playOriginalReference() {
  try {
    await unlockAudio();
    if (!referenceBlob) {
      const blob = await loadDonor();
      if (!blob) throw new Error("no-voice");
      referenceBlob = blob;
    }
    const { samples, sampleRate } = await decodeToMono(referenceBlob, audioCtx);
    await playBufferOnce(samplesToBuffer(audioCtx, samples, sampleRate));
  } catch (err) {
    reportVoiceError(err);
  }
}

async function playCleanedReference() {
  try {
    const donor = await ensureDonor();
    if (!donor.cleaned) throw new Error("no-voice");
    await playBufferOnce(samplesToBuffer(audioCtx, donor.cleaned, donor.sr));
    showQuality();
  } catch (err) {
    reportVoiceError(err);
  }
}

function syncVoiceModeUi() {
  const on = getUseCustomVoice();
  const ui = t();
  modeCustomBtn?.classList.toggle("active", on);
  modeAiBtn?.classList.toggle("active", !on);
  if (useCustomEl) useCustomEl.checked = on;
  if (voiceModeHint) voiceModeHint.textContent = on ? ui.modeHintCustom : ui.modeHintAi;
}

function applyVoiceMode(useCustom) {
  setUseCustomVoice(!!useCustom);
  syncVoiceModeUi();
  setVoiceButtons();
  if (voiceHint) voiceHint.textContent = useCustom ? t().modeHintCustom : t().modeHintAi;
  if (!useCustom && store.lang === "ar") {
    speakArabicNeural(testPhrase())
      .then(() => setStatus("live", t().voicePlayingOnDevice))
      .catch(() => {});
  }
}

function updateVoiceHint() {
  const ui = t();
  syncVoiceModeUi();
  if (voiceRecorder) {
    if (voiceHint) voiceHint.textContent = ui.voiceRecording;
    return;
  }
  if (!getUseCustomVoice()) {
    if (voiceHint) voiceHint.textContent = ui.modeHintAi;
  } else if (voiceHint) {
    voiceHint.textContent = voiceProfiles.length ? ui.voiceSaved : ui.voiceMissing;
  }
  const applied = appliedProfile();
  if (voiceAppliedEl) {
    voiceAppliedEl.textContent = applied ? `${ui.voiceApplied}: ${applied.name}` : ui.voiceNone;
  }
}

async function refreshVoiceProfiles() {
  try {
    voiceProfiles = await listVoiceProfiles();
  } catch {
    voiceProfiles = [];
  }
  renderVoiceList();
  updateVoiceHint();
  setVoiceButtons();
}

function renderVoiceList() {
  if (!voiceListEl) return;
  const ui = t();
  voiceListEl.innerHTML = "";
  voiceProfiles.forEach((item) => {
    const li = document.createElement("li");
    const mark = item.applied ? ` · ${ui.voiceApplied}` : "";
    li.innerHTML = `<span><strong>${item.name}</strong><small>${new Date(item.ts).toLocaleString()} ${mark}</small></span>`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const play = document.createElement("button");
    play.className = "tiny";
    play.textContent = ui.playVoice;
    play.addEventListener("click", async () => {
      applyVoiceProfile(item.id);
      donorModel = null;
      donorId = null;
      await refreshVoiceProfiles();
      const demo = testPhrase();
      try {
        if (store.lang === "ar" && !getUseCustomVoice()) await speakArabicNeural(demo);
        else await speakCloned(demo);
      } catch (err) {
        reportVoiceError(err);
      }
    });
    const apply = document.createElement("button");
    apply.className = "tiny";
    apply.textContent = ui.applyVoice;
    apply.addEventListener("click", async () => {
      applyVoiceProfile(item.id);
      pendingVoice = null;
      donorModel = null;
      donorId = null;
      await refreshVoiceProfiles();
      try {
        await ensureDonor();
        if (store.lang === "ar" && !getUseCustomVoice()) await speakArabicNeural(testPhrase());
        else await speakCloned(testPhrase());
        if (voiceHint) voiceHint.textContent = ui.voiceSaved;
      } catch (err) {
        reportVoiceError(err);
      }
    });
    const drop = document.createElement("button");
    drop.className = "tiny";
    drop.textContent = ui.deleteVoice;
    drop.addEventListener("click", async () => {
      await deleteVoiceProfile(item.id);
      await deleteCloudVoiceByName(item.name);
      if (pendingVoice?.id === item.id) pendingVoice = null;
      donorModel = null;
      donorId = null;
      await refreshVoiceProfiles();
    });
    actions.append(play, apply, drop);
    li.appendChild(actions);
    voiceListEl.appendChild(li);
  });
}

function testPhrase() {
  const typed = (voiceTestText?.value || "").trim();
  if (typed) return typed;
  return store.lang === "ar" ? "مرحبا كيف حالك" : "Hello, how are you?";
}

async function adoptVoice(blob) {
  const ui = t();
  if (!blob || blob.size < 400) {
    if (voiceHint) voiceHint.textContent = ui.voiceBadFile;
    return;
  }
  let donor;
  try {
    await unlockAudio();
    donor = await buildDonor(blob, audioCtx);
  } catch (err) {
    reportVoiceError(err);
    return;
  }
  const id = await saveDonor(blob);
  donorModel = donor;
  donorId = id;
  referenceBlob = blob;
  pendingVoice = { id, blob, name: ui.myVoice };
  await refreshVoiceProfiles();
  await pushVoiceProfileToCloud(blob, ui.myVoice);
  if (voiceHint) voiceHint.textContent = ui.voiceSaved;
  showQuality();
  setVoiceButtons();
  try {
    if (store.lang === "ar" && !getUseCustomVoice()) await speakArabicNeural(testPhrase());
    else await speakCloned(testPhrase());
  } catch (err) {
    reportVoiceError(err);
  }
}

async function startVoiceCapture() {
  const ui = t();
  try {
    await unlockAudio();
  } catch {
    /* recording can still proceed */
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch {
    if (voiceHint) voiceHint.textContent = ui.voiceDenied;
    return;
  }
  voiceChunks = [];
  const mime = pickRecorderMime();
  try {
    voiceRecorder = mime ? new MediaRecorder(voiceStream, { mimeType: mime }) : new MediaRecorder(voiceStream);
  } catch {
    voiceRecorder = new MediaRecorder(voiceStream);
  }
  voiceRecorder.ondataavailable = (event) => {
    if (event.data?.size) voiceChunks.push(event.data);
  };
  voiceRecorder.onstop = async () => {
    const mimeType = voiceRecorder?.mimeType || mime || "audio/webm";
    const blob = new Blob(voiceChunks, { type: mimeType });
    voiceChunks = [];
    voiceRecorder = null;
    voiceStream?.getTracks().forEach((track) => track.stop());
    voiceStream = null;
    setVoiceButtons();
    await adoptVoice(blob);
  };
  voiceRecorder.start(80);
  setVoiceButtons();
  updateVoiceHint();
}

function stopVoiceCapture() {
  if (voiceRecorder && voiceRecorder.state !== "inactive") voiceRecorder.stop();
}

function arabicVoiceScore(voice) {
  const lang = String(voice.lang || "").toLowerCase();
  const name = String(voice.name || "").toLowerCase();
  if (lang.startsWith("ar")) {
    if (lang.includes("sa") || name.includes("saudi") || name.includes("naayf") || name.includes("hoda") || name.includes("maged")) return 5;
    if (lang.includes("eg") || name.includes("egypt")) return 4;
    return 3;
  }
  if (name.includes("arabic") || name.includes("عربي") || name.includes("arab")) return 2;
  return 0;
}

function voicesForLang() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const prefix = t().voicePrefix;
  if (prefix === "ar") {
    const scored = voices
      .map((v) => ({ v, s: arabicVoiceScore(v) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.map((x) => x.v);
  }
  return voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
}

function fillVoices() {
  if (!voiceSelect || !window.speechSynthesis) return;
  const matched = voicesForLang();
  const prev = voiceSelect.value;
  voiceSelect.innerHTML = "";
  if (store.lang === "ar") {
    const onDevice = document.createElement("option");
    onDevice.value = "";
    onDevice.textContent = t().voiceOnDeviceAr || "Arabic AI voice";
    voiceSelect.appendChild(onDevice);
    matched.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = `${v.name} (${v.lang})`;
      voiceSelect.appendChild(opt);
    });
    if (prev && [...voiceSelect.options].some((o) => o.value === prev)) voiceSelect.value = prev;
    else voiceSelect.value = "";
    return;
  }
  const voices = speechSynthesis.getVoices();
  const list = matched.length ? matched : voices;
  list.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });
  if (prev && [...voiceSelect.options].some((o) => o.value === prev)) voiceSelect.value = prev;
}

speechSynthesis.addEventListener("voiceschanged", fillVoices);
fillVoices();

function renderPhrases() {
  const current = pack();
  phraseGrid.innerHTML = "";
  if (!current.templates.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t().emptyYours;
    phraseGrid.appendChild(p);
    return;
  }
  current.templates.forEach((trained) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = trained.text;
    const strength = phraseStrength(trained, store.lang);
    btn.classList.add(`strength-${strength.level}`);
    btn.title = `${trained.takes.length} · ${strength.label}`;
    btn.addEventListener("click", () => commit(trained.text, true));
    phraseGrid.appendChild(btn);
  });
}

function renderLog() {
  logEl.innerHTML = "";
  pack().log.slice(-12).reverse().forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    logEl.appendChild(li);
  });
}

function renderTrainProgress(item) {
  if (!trainProgress) return;
  const n = item?.takes?.length || 0;
  const goal = TARGET_TAKES;
  const pct = Math.min(100, Math.round((n / goal) * 100));
  trainProgress.style.width = `${pct}%`;
  trainProgress.parentElement?.setAttribute("aria-valuenow", String(pct));
  renderAngles(item, nextAngleFor(item));
}

function renderTrained() {
  const ui = t();
  const current = pack();
  trainedList.innerHTML = "";
  current.templates.forEach((item, idx) => {
    const strength = phraseStrength(item, store.lang);
    const li = document.createElement("li");
    const n = item.takes.length;
    const goal = TARGET_TAKES;
    const angles = coveredAngles(item);
    const angleBit = angles.length ? ` · ${angles.map(angleLabel).join(" · ")}` : "";
    const label = n ? `${Math.min(n, goal)}/${goal} · ${strength.label}${angleBit}` : ui.needsRetrain;
    li.innerHTML = `<span><strong>${item.text}</strong><small>${label}</small></span>`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const more = document.createElement("button");
    more.className = "tiny";
    more.textContent = n >= goal ? ui.addMore : ui.keepTraining;
    more.addEventListener("click", () => {
      trainText.value = item.text;
      rebuildGuide();
      startRecording(item.text, n);
    });
    const del = document.createElement("button");
    del.className = "tiny";
    del.textContent = ui.remove;
    del.addEventListener("click", () => {
      const removed = current.templates[idx];
      current.templates.splice(idx, 1);
      saveStore(store);
      renderTrained();
      renderPhrases();
      if (removed) pushDeletePhrase(removed.text);
    });
    actions.append(more, del);
    li.appendChild(actions);
    trainedList.appendChild(li);
  });
}

function isUsablePrediction(text) {
  if (!text) return false;
  const ui = t();
  if (text === ui.reading || text === ui.idlePredict || text === ui.tooShort) return false;
  return !text.startsWith("Show your whole face") && text !== ui.noFace;
}

function showPrediction(text, extras = [], meta = {}) {
  currentText = isUsablePrediction(text) ? text : "";
  predictionEl.textContent = text || t().idlePredict;
  speakBtn.disabled = !currentText;
  const confirmBtn = document.getElementById("btn-confirm");
  if (confirmBtn) confirmBtn.disabled = !currentText;
  const recPhraseBtn = document.getElementById("btn-record-phrase");
  if (recPhraseBtn) recPhraseBtn.disabled = !currentText;
  candidatesEl.innerHTML = "";
  extras.forEach((item) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const pct = item.confidence != null ? Math.round(item.confidence * 100) : null;
    btn.textContent = pct != null ? `${item.text} · ${pct}%` : item.text;
    btn.addEventListener("click", () => commit(item.text, true));
    candidatesEl.appendChild(btn);
  });
  if (confidenceEl) {
    if (meta.confidence != null && currentText) {
      const pct = Math.round(meta.confidence * 100);
      confidenceEl.textContent = `${pct}% ${t().fromLips}`;
      confidenceEl.className = `confidence ${pct < 40 ? "low" : pct < 65 ? "mid" : "high"}`;
    } else {
      confidenceEl.textContent = "";
      confidenceEl.className = "confidence";
    }
  }
}

function learnFromUtterance(text) {
  if (!lastUtterance?.seq?.length || !text) return;
  const seq = lastUtterance.seq;
  const pose = lastUtterance.pose;
  const result = addTake(pack(), text, seq, pose, store.lang);
  lastUtterance = null;
  if (result.ok) {
    saveStore(store);
    renderTrained();
    renderPhrases();
    pushTake(text, seq, pose, result.quality || null);
  }
}

function announce(text) {
  if (!text || !isUsablePrediction(text)) return;
  currentText = text;
  predictionEl.textContent = text;
  speakBtn.disabled = false;
  pack().log.push(text);
  if (pack().log.length > 80) pack().log = pack().log.slice(-80);
  saveStore(store);
  renderLog();
  speak(text).catch(() => {});
}

function commit(text, say) {
  if (!text || !isUsablePrediction(text)) return;
  learnFromUtterance(text);
  currentText = text;
  predictionEl.textContent = text;
  speakBtn.disabled = false;
  pack().log.push(text);
  if (pack().log.length > 80) pack().log = pack().log.slice(-80);
  saveStore(store);
  renderLog();
  if (say || settings.autospeak) speak(text).catch(() => {});
}

function beginListen() {
  if (capturing) return;
  capturing = true;
  captureStarted = performance.now();
  buffer = [];
  currentText = "";
  stableLive = { text: "", count: 0 };
  showPrediction(t().reading);
  speakBtn.disabled = true;
  const confirmBtn = document.getElementById("btn-confirm");
  if (confirmBtn) confirmBtn.disabled = true;
  const recPhraseBtn = document.getElementById("btn-record-phrase");
  if (recPhraseBtn) recPhraseBtn.disabled = true;
  setStatus("listen", t().reading);
}

function finishUtterance() {
  capturing = false;
  cooldownUntil = performance.now() + settings.pause;
  if (buffer.length < 6) {
    buffer = [];
    showPrediction(t().idlePredict);
    setStatus("live", t().tooShort);
    return;
  }
  const seq = buffer.slice();
  buffer = [];
  const matches = matchSequence(seq, pack().templates, settings.sensitivity, pack().log, store.lang, livePose);
  lastUtterance = { seq, matches, pose: livePose };
  if (!matches.length) {
    currentText = "";
    showPrediction(t().noFace);
    speakBtn.disabled = true;
    setStatus("live", t().noFace);
    return;
  }
  const top = matches[0];
  const sure = !top.ambiguous && top.confidence >= 0.34;
  showPrediction(top.text, matches.slice(1), { confidence: top.confidence, source: top.source });
  setStatus("live", sure ? t().readStatus : t().guessStatus);
  if (settings.autospeak) announce(top.text);
}

function startRecording(text, existing = 0) {
  const item = findItem(text);
  const next = nextAngleFor(item);
  recordMode = { text, count: existing, needed: TARGET_TAKES, next };
  recordBuf = [];
  recordPoses = [];
  recordBtn.textContent = t().listening;
  renderTrainProgress(item || { takes: [] });
  const remain = Math.max(0, TARGET_TAKES - existing);
  trainHint.textContent = `${poseHint(next)} ${t().aimTakes} ${remain} ${t().takes}.`;
  setCoach(`${t().nextAngle}: ${angleLabel(next)}.`);
}

function finishRecordTake() {
  if (!recordMode) {
    recordBuf = [];
    recordPoses = [];
    return;
  }
  const text = recordMode.text.trim();
  const pose = recordPoses[Math.floor(recordPoses.length / 2)] || recordPoses[0] || livePose;
  const seq = recordBuf.slice();
  const result = addTake(pack(), text, seq, pose, store.lang);
  recordBuf = [];
  recordPoses = [];
  if (!result.ok) {
    if (result.clash) {
      const next = result.nextAngle || recordMode.next || "front";
      trainHint.textContent = clashMessage(result);
      setCoach(`${poseHint(next)} ${result.clash.tip || ""}`.trim());
      renderTrainProgress(result.item || findItem(text) || { takes: [] });
    } else {
      trainHint.textContent = result.reason;
      setCoach("");
    }
    return;
  }
  saveStore(store);
  renderTrained();
  renderPhrases();
  pushTake(text, seq, pose, result.quality || null);
  const n = result.item.takes.length;
  const next = result.nextAngle || nextAngleFor(result.item);
  recordMode.count = n;
  recordMode.next = next;
  renderTrainProgress(result.item);
  trainHint.textContent = `${t().savedTake} ${Math.min(n, TARGET_TAKES)}/${TARGET_TAKES} · ${angleLabel(pose?.slot || "front")}. ${poseHint(next)}`;
  setCoach(`${t().nextAngle}: ${angleLabel(next)}.`);
  if (n >= TARGET_TAKES && coveredAngles(result.item).length >= 3) {
    recordMode = null;
    recordBtn.textContent = t().startRec;
    trainHint.textContent = `${text} ${t().trainedDone}`;
    setCoach("");
  }
}

async function loop() {
  if (!running) return;
  if (video.readyState >= 2) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = landmarker.detectForVideo(video, performance.now());
      const face = result.faceLandmarks?.[0];
      const blends = result.faceBlendshapes?.[0]?.categories;
      if (face) {
        const pose = facePose(face);
        livePose = pose;
        const trainOpen = !document.getElementById("modal-train").classList.contains("hidden");
        const quality = recordMode || trainOpen ? trainFaceQuality(face) : faceQuality(face);
        const features = extractFeatures(face, blends, performance.now());
        const viseme = visemeFromFeatures(features);
        const talking = quality.ok && detector.update(features, viseme);
        meter.style.height = `${Math.min(100, 8 + features[8] * 160)}%`;
        if (!quality.ok) {
          faceBadge.textContent =
            quality.reason === "too-far"
              ? t().moveCloser
              : quality.reason === "turned"
                ? t().faceTheCamera
                : t().showMouth;
        } else if (recordMode) {
          faceBadge.textContent = talking
            ? `${t().mouthLabel}: ${viseme}`
            : `${angleLabel(pose.slot)} · ${angleLabel(recordMode.next)}`;
        } else {
          faceBadge.textContent = talking ? `${t().mouthLabel}: ${viseme}` : t().faceFound;
        }
        drawLips(ctx, face, canvas.width, canvas.height, talking);

        if (performance.now() < cooldownUntil && !recordMode) {
          capturing = false;
        } else if (recordMode) {
          if (talking) {
            recordBuf.push(features);
            recordPoses.push(pose);
            if (recordBuf.length === 1) trainHint.textContent = t().recording;
          } else if (recordBuf.length) {
            finishRecordTake();
          }
        } else if (trainOpen) {
          capturing = false;
          buffer = [];
        } else if (talking) {
          beginListen();
          buffer.push(features);
          if (buffer.length > 160) buffer = buffer.slice(-160);
          liveTick += 1;
          if (liveTick % 6 === 0 && buffer.length > 6) {
            const live = matchSequence(buffer, pack().templates, settings.sensitivity, pack().log, store.lang, livePose);
            const liveText = live[0]?.text || "";
            if (visemeStrip) visemeStrip.textContent = liveText ? `live: ${liveText}` : viseme;
            if (liveText && liveText === stableLive.text) stableLive.count += 1;
            else stableLive = { text: liveText, count: liveText ? 1 : 0 };
            const heldLong = capturing && performance.now() - captureStarted > 1400 && buffer.length >= 10;
            const stableEnough = stableLive.count >= 2 && live[0]?.confidence >= 0.28;
            if (heldLong || stableEnough) {
              if (visemeStrip) visemeStrip.textContent = "";
              finishUtterance();
            }
          }
        } else if (capturing) {
          if (visemeStrip) visemeStrip.textContent = "";
          finishUtterance();
        }
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        faceBadge.textContent = t().lookingFace;
        setStatus("idle", t().centerFace);
      }
    }
  }
  requestAnimationFrame(loop);
}

async function start() {
  setStatus("idle", t().startingCamera);
  try {
    await unlockAudio();
  } catch {
    /* camera still works without audio unlock */
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
  landmarker = await createLandmarker();
  running = true;
  gate.classList.add("hidden");
  setStatus("live", t().faceCamera);
  loop();
}

document.getElementById("btn-start")?.addEventListener("click", () => {
  start().catch(() => {
    gate.classList.remove("hidden");
    setStatus("idle", t().cameraRequired);
  });
});

start().catch((err) => {
  gate.classList.remove("hidden");
  const msg = String(err?.name || err?.message || "");
  setStatus(
    "idle",
    /notallowed|permission|notreadable|overconstrained|notfound/i.test(msg) ? t().cameraRequired : t().cameraRequired
  );
});

document.getElementById("btn-confirm")?.addEventListener("click", () => {
  if (!currentText) return;
  learnFromUtterance(currentText);
  setStatus("live", `${t().learned} “${currentText}”.`);
});
document.getElementById("btn-speak").addEventListener("click", () => {
  if (!currentText) return;
  speak(currentText).catch(() => {});
});
arAiBtn?.addEventListener("click", () => {
  const phrase = currentText || testPhrase() || (store.lang === "ar" ? "مرحبا كيف حالك" : "مرحبا");
  speakArabicNeural(phrase)
    .then(() => setStatus("live", t().voicePlayingOnDevice))
    .catch((err) => reportVoiceError(err, false));
});
document.getElementById("btn-clear").addEventListener("click", () => {
  currentText = "";
  lastUtterance = null;
  capturing = false;
  buffer = [];
  detector.reset();
  showPrediction("");
});
document.getElementById("btn-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(pack().log.join("\n"));
  setStatus("live", t().copied);
});
document.getElementById("btn-delete-log")?.addEventListener("click", () => {
  pack().log = [];
  saveStore(store);
  renderLog();
});

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.scrollTop = 0;
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add("hidden");
  if (!document.querySelector(".modal:not(.hidden)")) {
    document.body.style.overflow = "";
  }
}

document.getElementById("btn-settings").addEventListener("click", () => {
  openModal("modal-settings");
});
document.getElementById("btn-train").addEventListener("click", () => {
  openModal("modal-train");
  renderTrained();
  const item = findItem(trainText?.value?.trim());
  renderTrainProgress(item || { takes: [] });
  rebuildGuide();
  if (item) setCoach(`${t().nextAngle}: ${angleLabel(nextAngleFor(item))}.`);
});
document.querySelectorAll(".close-modal").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});

document.getElementById("opt-autospeak").addEventListener("change", (e) => {
  settings.autospeak = e.target.checked;
  pushSettings();
});
if (useCustomEl) {
  useCustomEl.checked = getUseCustomVoice();
  useCustomEl.addEventListener("change", () => {
    applyVoiceMode(!!useCustomEl.checked);
    pushSettings();
  });
}
modeCustomBtn?.addEventListener("click", () => applyVoiceMode(true));
modeAiBtn?.addEventListener("click", () => applyVoiceMode(false));
document.getElementById("opt-sensitivity").addEventListener("input", (e) => {
  settings.sensitivity = Number(e.target.value);
});
document.getElementById("opt-sensitivity").addEventListener("change", () => pushSettings());
document.getElementById("opt-pause").addEventListener("input", (e) => {
  settings.pause = Number(e.target.value);
});
document.getElementById("opt-pause").addEventListener("change", () => pushSettings());

trainText?.addEventListener("input", () => {
  const item = findItem(trainText.value.trim());
  renderTrainProgress(item || { takes: [] });
  rebuildGuide();
  if (!recordMode) {
    const next = nextAngleFor(item);
    setCoach(item ? `${t().nextAngle}: ${angleLabel(next)}.` : "");
  }
});

document.getElementById("btn-voice-panel")?.addEventListener("click", () => {
  openModal("modal-voice");
  refreshVoiceProfiles();
});

voiceBtn?.addEventListener("click", () => {
  if (voiceRecorder) {
    stopVoiceCapture();
    return;
  }
  startVoiceCapture();
});

voiceFile?.addEventListener("change", async () => {
  const file = voiceFile.files?.[0];
  voiceFile.value = "";
  if (!file) return;
  if (voiceHint) voiceHint.textContent = t().voiceQueue;
  await adoptVoice(file);
});

document.getElementById("btn-record-phrase")?.addEventListener("click", () => {
  openModal("modal-voice");
  refreshVoiceProfiles();
});

async function speakTestPhrase() {
  const phrase = testPhrase();
  if (store.lang === "ar") {
    lastProvider = await speakArabicNeural(phrase);
    if (voiceHint) voiceHint.textContent = t().voicePlayingOnDevice;
    return;
  }
  if (!getUseCustomVoice()) {
    const provider = await speakRobot(phrase);
    lastProvider = provider;
    if (voiceHint) voiceHint.textContent = t().voicePlayingRobot;
    return;
  }
  await speakCloned(phrase);
  if (voiceHint) voiceHint.textContent = t().voicePlaying;
}

voicePreviewBtn?.addEventListener("click", async () => {
  try {
    await speakTestPhrase();
  } catch (err) {
    reportVoiceError(err);
  }
});

voiceTestBtn?.addEventListener("click", async () => {
  try {
    await speakTestPhrase();
  } catch (err) {
    reportVoiceError(err);
  }
});

voiceHearOriginalBtn?.addEventListener("click", playOriginalReference);
voiceHearCleanBtn?.addEventListener("click", playCleanedReference);
voiceHearGeneratedBtn?.addEventListener("click", async () => {
  try {
    await playGeneratedWav();
  } catch (err) {
    reportVoiceError(err);
  }
});

function populateTTS() {
  const cfg = getTTSSettings();
  if (ttsEnabled) ttsEnabled.checked = !!cfg.enabled;
  if (ttsUrl) ttsUrl.value = cfg.url || "";
  if (ttsKey) ttsKey.value = cfg.key || "";
  if (ttsVoiceName) ttsVoiceName.value = cfg.voice || "";
}

function readTTS() {
  return {
    enabled: !!ttsEnabled?.checked,
    url: (ttsUrl?.value || "").trim(),
    key: ttsKey?.value || "",
    voice: (ttsVoiceName?.value || "").trim(),
  };
}

ttsSaveBtn?.addEventListener("click", () => {
  saveTTSSettings(readTTS());
  if (voiceHint) voiceHint.textContent = t().ttsSaved;
});

ttsTestBtn?.addEventListener("click", async () => {
  const cfg = saveTTSSettings(readTTS());
  if (!remoteReady(cfg)) {
    if (voiceHint) voiceHint.textContent = t().ttsNeedUrl;
    return;
  }
  if (voiceHint) voiceHint.textContent = t().ttsTesting;
  try {
    await unlockAudio();
    const audio = await testRemote(cfg, audioCtx, testPhrase(), store.lang);
    await playBufferOnce(audio);
    if (voiceHint) voiceHint.textContent = t().ttsOk;
  } catch {
    if (voiceHint) voiceHint.textContent = t().ttsFail;
  }
});

populateTTS();

recordBtn.addEventListener("click", () => {
  const text = trainText.value.trim();
  if (!text) {
    trainHint.textContent = t().typePhrase;
    return;
  }
  if (recordMode) {
    recordMode = null;
    recordBuf = [];
    recordPoses = [];
    recordBtn.textContent = t().startRec;
    trainHint.textContent = t().stopped;
    setCoach("");
    return;
  }
  const existing = pack().templates.find((item) => item.text.toLowerCase() === text.toLowerCase());
  startRecording(text, existing?.takes.length || 0);
});

document.getElementById("btn-essentials").addEventListener("click", () => {
  const list = essentialsFor(store.lang);
  const current = pack();
  trainText.value = list.find((p) => !current.templates.some((item) => item.text === p)) || list[0];
  trainHint.textContent = `${t().nextEssential}: “${trainText.value}”. ${t().pressStart} ${t().aimTakes} ${TARGET_TAKES} ${t().takes}.`;
  rebuildGuide();
});

function setFieldLabel(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const control = el.querySelector("input, select");
  el.textContent = "";
  el.append(text, control);
}

function applyLanguage() {
  const ui = t();
  document.documentElement.lang = ui.htmlLang;
  document.documentElement.dir = ui.dir;
  document.getElementById("lang-en")?.classList.toggle("active", store.lang === "en");
  document.getElementById("lang-ar")?.classList.toggle("active", store.lang === "ar");
  const map = [
    ["brand-sub", ui.brandSub],
    ["btn-settings", ui.settings],
    ["btn-voice-panel", ui.myVoice],
    ["btn-train", ui.train],
    ["kicker", ui.kicker],
    ["btn-confirm", ui.confirm],
    ["btn-speak", ui.sayAgain],
    ["btn-ar-ai", ui.hearArabicAi],
    ["btn-record-phrase", voiceRecorder ? ui.stopVoice : ui.recordThisPhrase],
    ["btn-clear", ui.clear],
    ["log-title", ui.conversation],
    ["btn-copy", ui.copy],
    ["btn-delete-log", ui.deleteLog],
    ["backup-title", ui.backup],
    ["backup-hint", ui.backupHint],
    ["lbl-autospeak", ui.autospeak],
    ["lbl-use-custom", ui.useCustom],
    ["use-custom-hint", ui.useCustomHint],
    ["btn-mode-custom", ui.modeCustom],
    ["btn-mode-ai", ui.modeAi],
    ["settings-title", ui.settings],
    ["btn-settings-done", ui.done],
    ["train-title", ui.trainTitle],
    ["train-lead", ui.trainLead],
    ["btn-record", recordMode ? ui.listening : ui.startRec],
    ["btn-voice", voiceRecorder ? ui.stopVoice : ui.recordVoice],
    ["btn-voice-preview", ui.playVoice],
    ["btn-voice-test", ui.voiceTestBtn],
    ["btn-voice-hear-original", ui.voiceHearOriginal],
    ["btn-voice-hear-clean", ui.voiceHearClean],
    ["btn-voice-hear-generated", ui.voiceHearGenerated],
    ["voice-title", ui.voiceTitle],
    ["voice-lead", ui.voiceLead],
    ["btn-voice-done", ui.done],
    ["btn-voice-close", ui.done],
    ["btn-essentials", ui.loadEssentials],
    ["btn-train-done", ui.done],
    ["btn-train-close", ui.done],
    ["pg-title", ui.pgTitle],
    ["pg-play", ui.pgPlay],
    ["pg-pause", ui.pgPause],
    ["pg-replay", ui.pgReplay],
    ["pg-accent-lbl", ui.pgAccent],
    ["gate-title", ui.gateTitle],
    ["gate-body", ui.gateBody],
    ["step1", ui.step1],
    ["step2", ui.step2],
    ["step3", ui.step3],
    ["btn-start", ui.startCam],
    ["gate-fine", ui.fine],
    ["btn-install", ui.install],
    ["btn-install-banner", ui.install],
    ["install-title", ui.installTitle],
    ["install-hint", installHintText()],
  ];
  map.forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  });
  setFieldLabel("lbl-strict", ui.strictness);
  setFieldLabel("lbl-pause", ui.pause);
  setFieldLabel("lbl-voice", ui.voice);
  setFieldLabel("lbl-phrase", ui.phrase);
  setFieldLabel("lbl-voice-upload", ui.uploadVoice);
  setFieldLabel("lbl-voice-test", ui.voiceTest);
  if (voiceTestText) voiceTestText.placeholder = ui.voiceTestPh;
  if (trainText) trainText.placeholder = ui.placeholder;
  if (!recordMode && trainHint) trainHint.textContent = ui.trainHint;
  if (!recordMode) setCoach("");
  const active = findItem(trainText?.value?.trim());
  renderAngles(active, nextAngleFor(active));
  if (pgSlow) pgSlow.textContent = pronounce.slow ? ui.pgNormal : ui.pgSlow;
  rebuildGuide();
  if (!running) {
    const badge = document.getElementById("face-badge");
    if (badge) badge.textContent = ui.lookingFace;
    setStatus("idle", ui.allowCamera);
  }
  syncVoiceModeUi();
  fillVoices();
  renderPhrases();
  renderLog();
  renderTrained();
  refreshVoiceProfiles();
  showPrediction(currentText || ui.idlePredict);
}

function switchLang(lang) {
  if (store.lang === lang) return;
  store.lang = lang;
  if (lang === "ar") setUseCustomVoice(false);
  saveStore(store);
  lastUtterance = null;
  currentText = "";
  capturing = false;
  buffer = [];
  recordMode = null;
  recordBuf = [];
  recordPoses = [];
  applyLanguage();
}

pgPlay?.addEventListener("click", () => playGuide(false));
pgPause?.addEventListener("click", () => stopGuide());
pgReplay?.addEventListener("click", () => playGuide(true));
pgSlow?.addEventListener("click", () => {
  pronounce.slow = !pronounce.slow;
  if (pgSlow) pgSlow.textContent = pronounce.slow ? t().pgNormal : t().pgSlow;
});
pgAccent?.addEventListener("change", () => rebuildGuide());

document.getElementById("lang-en")?.addEventListener("click", () => switchLang("en"));
document.getElementById("lang-ar")?.addEventListener("click", () => switchLang("ar"));

applyLanguage();
if (store.needsRetrain?.length) {
  setStatus("idle", `${t().retrain}: ${store.needsRetrain.slice(0, 3).join(", ")}. ${t().oldShallow}`);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isAndroid() {
  return /android/i.test(navigator.userAgent);
}

function installHintText() {
  const ui = t();
  if (isStandalone()) return ui.installed;
  if (isIos()) return ui.iosInstall;
  if (isAndroid()) return ui.androidInstall;
  return ui.installHint;
}

let deferredInstall = null;
const installSheet = document.getElementById("install-sheet");
const installBtn = document.getElementById("btn-install");
const installBannerBtn = document.getElementById("btn-install-banner");

function showInstall(show) {
  installSheet?.classList.toggle("hidden", !show);
  installBtn?.classList.toggle("hidden", !show);
}

async function promptInstall() {
  const hint = document.getElementById("install-hint");
  if (hint) hint.textContent = installHintText();
  showInstall(true);
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const choice = await deferredInstall.userChoice;
  deferredInstall = null;
  if (choice?.outcome === "accepted") showInstall(false);
  else showInstall(true);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstall = event;
  if (!isStandalone()) showInstall(true);
});

window.addEventListener("appinstalled", () => {
  deferredInstall = null;
  showInstall(false);
  document.body.classList.add("standalone");
  setStatus("live", t().installed);
});

installBtn?.addEventListener("click", () => promptInstall());
installBannerBtn?.addEventListener("click", () => promptInstall());

if (isStandalone()) {
  document.body.classList.add("standalone");
  showInstall(false);
} else {
  showInstall(true);
  const hint = document.getElementById("install-hint");
  if (hint) hint.textContent = installHintText();
}

function stripHostBubble() {
  const nodes = document.querySelectorAll("#mcai-inject-bubble, [id^='mcai-inject']");
  nodes.forEach((el) => el.remove());
}

stripHostBubble();
new MutationObserver((records) => {
  for (const rec of records) {
    for (const node of rec.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.id === "mcai-inject-bubble" || (typeof node.id === "string" && node.id.startsWith("mcai-inject"))) {
        node.remove();
      } else if (node.querySelector) {
        node.querySelectorAll("#mcai-inject-bubble, [id^='mcai-inject']").forEach((el) => el.remove());
      }
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// ============================================================ cloud UI wiring
const authMsg = document.getElementById("auth-msg");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authName = document.getElementById("auth-name");
const authNameField = document.getElementById("lbl-auth-name");
const authSubmit = document.getElementById("btn-auth-submit");
const authReset = document.getElementById("btn-auth-reset");
const tabLogin = document.getElementById("auth-tab-login");
const tabRegister = document.getElementById("auth-tab-register");
let authMode = "login";

function setAuthMode(mode) {
  authMode = mode;
  tabLogin?.classList.toggle("active", mode === "login");
  tabRegister?.classList.toggle("active", mode === "register");
  authNameField?.classList.toggle("hidden", mode !== "register");
  if (authSubmit) authSubmit.textContent = mode === "login" ? t().signIn : t().createAccount;
  if (authPassword) authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
}

function setAuthMsg(text, isError = false) {
  if (!authMsg) return;
  authMsg.textContent = text || "";
  authMsg.style.color = isError ? "#c0504d" : "";
}

function setAuthBusy(busy) {
  if (authSubmit) authSubmit.disabled = busy;
  if (authReset) authReset.disabled = busy;
}

tabLogin?.addEventListener("click", () => setAuthMode("login"));
tabRegister?.addEventListener("click", () => setAuthMode("register"));

document.getElementById("btn-cloud")?.addEventListener("click", async () => {
  openModal("modal-cloud");
  if (cloud.cloudEnabled) {
    const session = await cloud.getSession();
    setSignedInView(session);
  }
});
document.getElementById("btn-cloud-close")?.addEventListener("click", () => closeModal("modal-cloud"));

authSubmit?.addEventListener("click", async () => {
  const email = authEmail?.value?.trim();
  const password = authPassword?.value || "";
  if (!email || !password) { setAuthMsg(t().authFailed, true); return; }
  setAuthBusy(true);
  setAuthMsg(t().authWorking);
  try {
    if (authMode === "login") {
      await cloud.signIn(email, password);
    } else {
      await cloud.signUp(email, password, authName?.value?.trim());
      setAuthMsg(t().authRegisterOk);
      setAuthMode("login");
    }
  } catch (err) {
    setAuthMsg(`${t().authFailed} (${err?.message || err})`, true);
  } finally {
    setAuthBusy(false);
  }
});

authReset?.addEventListener("click", async () => {
  const email = authEmail?.value?.trim();
  if (!email) { setAuthMsg(t().authFailed, true); return; }
  setAuthBusy(true);
  try {
    await cloud.resetPassword(email);
    setAuthMsg(t().authResetSent);
  } catch (err) {
    setAuthMsg(`${t().authFailed} (${err?.message || err})`, true);
  } finally {
    setAuthBusy(false);
  }
});

document.getElementById("btn-signout")?.addEventListener("click", async () => {
  await cloud.signOut();
  setSignedInView(null);
  setAuthMode("login");
  setAuthMsg(t().signedOutHint);
});
document.getElementById("btn-sync-now")?.addEventListener("click", () => pullCloud());
document.getElementById("btn-open-shared")?.addEventListener("click", () => {
  openModal("modal-shared");
  refreshSharedUi();
});
document.getElementById("btn-shared-close")?.addEventListener("click", () => closeModal("modal-shared"));

// ---- shared training ----
function sharedMsg(text, isError = false) {
  const el = document.getElementById("shared-msg");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = isError ? "#c0504d" : "";
}

async function refreshSharedUi() {
  const mineList = document.getElementById("shared-mine-list");
  const availList = document.getElementById("shared-available-list");
  const modBlock = document.getElementById("shared-mod-block");
  if (!cloudReady()) {
    sharedMsg(t().cloudOffline, true);
    if (mineList) mineList.innerHTML = "";
    if (availList) availList.innerHTML = "";
    return;
  }
  try {
    // My personal phrases that can be contributed.
    const personal = pack().templates;
    if (mineList) {
      mineList.innerHTML = "";
      if (!personal.length) {
        const li = document.createElement("li");
        li.textContent = t().sharedEmptyMine;
        mineList.appendChild(li);
      }
      personal.forEach((tpl) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.innerHTML = `<strong>${tpl.text}</strong><small>${t().personalOnly}</small>`;
        const btn = document.createElement("button");
        btn.className = "tiny";
        btn.textContent = t().sharedContribute;
        btn.addEventListener("click", async () => {
          try {
            const pid = await cloud.upsertPersonalPhrase(userId, store.lang, tpl.text);
            await cloud.contributeToShared(userId, pid);
            sharedMsg(t().sharedContributed);
            refreshSharedUi();
          } catch (err) { sharedMsg(t().sharedError, true); console.warn(err); }
        });
        li.append(span, btn);
        mineList.appendChild(li);
      });
    }

    // Approved shared phrases + my opt-in state.
    const [available, enrollments] = await Promise.all([
      cloud.listSharedPhrases(store.lang),
      cloud.listEnrollments(userId),
    ]);
    const enabledIds = new Set(enrollments.filter((e) => e.enabled).map((e) => e.phrase_id));
    if (availList) {
      availList.innerHTML = "";
      if (!available.length) {
        const li = document.createElement("li");
        li.textContent = t().sharedEmptyAvailable;
        availList.appendChild(li);
      }
      available.forEach((p) => {
        const li = document.createElement("li");
        const span = document.createElement("span");
        span.innerHTML = `<strong>${p.text}</strong><small>${p.takeCount} ${t().takes}</small>`;
        const btn = document.createElement("button");
        btn.className = "tiny";
        const on = enabledIds.has(p.id);
        btn.textContent = on ? t().sharedDisable : t().sharedEnable;
        btn.addEventListener("click", async () => {
          try {
            await cloud.setEnrollment(userId, p.id, !on);
            await pullCloud();
            refreshSharedUi();
          } catch (err) { sharedMsg(t().sharedError, true); console.warn(err); }
        });
        li.append(span, btn);
        availList.appendChild(li);
      });
    }

    // Moderation queue for moderators.
    if (cloudProfileRole === "moderator" && modBlock) {
      modBlock.classList.remove("hidden");
      const queue = await cloud.listSharedQueue();
      const modList = document.getElementById("shared-mod-list");
      if (modList) {
        modList.innerHTML = "";
        queue.forEach((p) => {
          const li = document.createElement("li");
          const span = document.createElement("span");
          span.innerHTML = `<strong>${p.text}</strong><small>${p.lang} · ${t().sharedPending}</small>`;
          const ok = document.createElement("button");
          ok.className = "tiny";
          ok.textContent = t().sharedApprove;
          ok.addEventListener("click", async () => {
            try { await cloud.moderateShared(p.id, true, null); refreshSharedUi(); }
            catch (err) { sharedMsg(t().sharedError, true); }
          });
          const no = document.createElement("button");
          no.className = "tiny";
          no.textContent = t().sharedReject;
          no.addEventListener("click", async () => {
            try { await cloud.moderateShared(p.id, false, "rejected"); refreshSharedUi(); }
            catch (err) { sharedMsg(t().sharedError, true); }
          });
          li.append(span, ok, no);
          modList.appendChild(li);
        });
      }
    } else {
      modBlock?.classList.add("hidden");
    }
  } catch (err) {
    sharedMsg(t().sharedError, true);
    console.warn("refreshSharedUi failed", err);
  }
}

// ---- auth subscription + boot ----
if (cloud.cloudEnabled) {
  setAuthMode("login");
  cloud.onAuthChange((event, session) => {
    const wasIn = Boolean(userId);
    setSignedInView(session);
    if (session?.user && !wasIn) onSignedIn(session);
    if (!session?.user) { userId = null; refreshUiAfterSync(); }
  });
  cloud.getSession().then((session) => {
    setSignedInView(session);
    if (session?.user) onSignedIn(session);
  });
} else {
  setSignedInView(null);
}


