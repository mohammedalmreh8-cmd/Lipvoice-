const DB_NAME = "lipvoice-voices";
const STORE_NAME = "clips";
const DB_VERSION = 1;
const META_KEY = "lipvoice-voice-meta";
const TTS_KEY = "lipvoice-tts";
const USE_CUSTOM_KEY = "lipvoice-use-custom";

const DEFAULT_TTS = { enabled: false, url: "", key: "", voice: "", headerName: "", headerValue: "", timeout: 15000 };

export function getTTSSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(TTS_KEY));
    return { ...DEFAULT_TTS, ...(saved || {}) };
  } catch {
    return { ...DEFAULT_TTS };
  }
}

export function saveTTSSettings(partial) {
  const merged = { ...getTTSSettings(), ...(partial || {}) };
  localStorage.setItem(TTS_KEY, JSON.stringify(merged));
  return merged;
}

export function getUseCustomVoice() {
  try {
    const v = localStorage.getItem(USE_CUSTOM_KEY);
    if (v === null) return false;
    return v !== "0";
  } catch {
    return false;
  }
}

export function setUseCustomVoice(on) {
  localStorage.setItem(USE_CUSTOM_KEY, on ? "1" : "0");
  return !!on;
}

function foldText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) || { appliedId: null };
  } catch {
    return { appliedId: null };
  }
}

function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

function profileKey(id) {
  return `voice::${id}`;
}

function toBlob(rec) {
  if (!rec) return null;
  if (rec instanceof Blob) return rec.size ? rec : null;
  if (rec instanceof ArrayBuffer && rec.byteLength) return new Blob([rec], { type: "audio/webm" });
  if (rec.buf) return new Blob([rec.buf], { type: rec.type || "audio/webm" });
  return null;
}

function toProfile(id, rec) {
  const blob = toBlob(rec);
  if (!blob) return null;
  return {
    id,
    name: rec.name || rec.phrase || id,
    phrase: rec.phrase || rec.name || id,
    ts: rec.ts || 0,
    type: rec.type || blob.type || "audio/webm",
    blob,
  };
}

export function getAppliedId() {
  return loadMeta().appliedId || null;
}

export async function listVoiceProfiles() {
  const db = await openDb();
  const appliedId = getAppliedId();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).openCursor();
    const out = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        out.sort((a, b) => b.ts - a.ts);
        resolve(out);
        return;
      }
      const key = String(cursor.key || "");
      if (key.startsWith("voice::")) {
        const profile = toProfile(key.slice(7), cursor.value);
        if (profile) {
          profile.applied = profile.id === appliedId;
          out.push(profile);
        }
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveVoiceProfile(name, blob) {
  if (!blob) return null;
  const buf = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  if (!buf || !buf.byteLength) return null;
  const id = `v${Date.now()}`;
  const label = String(name || "").trim() || "Voice";
  const rec = {
    id,
    name: label,
    phrase: label,
    buf,
    type: (blob.type && String(blob.type)) || "audio/webm",
    ts: Date.now(),
  };
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(rec, profileKey(id));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
  return id;
}

export async function loadVoiceById(id) {
  if (!id) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(profileKey(id));
    req.onsuccess = () => resolve(toBlob(req.result));
    req.onerror = () => reject(req.error);
  });
}

export async function loadAppliedVoice() {
  return loadVoiceById(getAppliedId());
}

export async function saveDonor(blob) {
  const id = await saveVoiceProfile("My voice", blob);
  applyVoiceProfile(id);
  return id;
}

export async function loadDonor() {
  return loadAppliedVoice();
}

export async function loadVoiceForPhrase(text) {
  const folded = foldText(text);
  if (!folded) return null;
  const profiles = await listVoiceProfiles();
  const match =
    profiles.find((item) => foldText(item.name) === folded) ||
    profiles.find((item) => foldText(item.phrase) === folded) ||
    profiles.find((item) => foldText(item.name).includes(folded) || folded.includes(foldText(item.name)));
  return match?.blob || null;
}

export function applyVoiceProfile(id) {
  const meta = loadMeta();
  meta.appliedId = id || null;
  saveMeta(meta);
  return meta.appliedId;
}

export async function deleteVoiceProfile(id) {
  if (!id) return;
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(profileKey(id));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
  const meta = loadMeta();
  if (meta.appliedId === id) {
    meta.appliedId = null;
    saveMeta(meta);
  }
}

export function pickRecorderMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return types.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
}
