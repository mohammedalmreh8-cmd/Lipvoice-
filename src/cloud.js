// Supabase client and data-access layer for LipVoice.
//
// This module is the single seam between the browser UI and the backend. It
// mirrors the shape the recognition engine already expects - a "store" of
// { lang, languages: { en, ar } }, where each pack is { templates, log } and
// each template is { text, takes: [{ seq, pose }] } - so engine.js is untouched.
//
// If no Supabase credentials are configured the app degrades to the previous
// on-device localStorage behaviour, and every cloud call reports itself off.
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL || "";
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const cloudEnabled = Boolean(URL && ANON && /^https?:\/\//.test(URL));

export const supabase = cloudEnabled ? createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

const RECORDINGS_BUCKET = "voice-recordings";

// ------------------------------------------------------------------ auth
export async function getSession() {
  if (!cloudEnabled) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session || null;
}

export function onAuthChange(cb) {
  if (!cloudEnabled) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data?.subscription?.unsubscribe?.();
}

export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || email.split("@")[0] } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!cloudEnabled) return;
  await supabase.auth.signOut();
}

export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/`,
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// The signed-in user's profile row. Used to discover the moderator role, which
// decides whether the shared-training moderation queue is shown.
export async function fetchProfile(userId) {
  if (!cloudEnabled || !userId) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, locale")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ------------------------------------------------------- store (recognition)
// Build the { templates, log } pack the engine consumes for one language.
// Personal phrases are the signed-in user's own rows; shared phrases are the
// approved public ones the user has explicitly opted into.
export async function fetchPack(userId, lang) {
  if (!cloudEnabled || !userId) return { templates: [], log: [] };

  const { data: personal, error: pErr } = await supabase
    .from("phrases")
    .select("id, text, takes(seq, pose)")
    .eq("owner", userId)
    .eq("lang", lang)
    .eq("scope", "personal");
  if (pErr) throw pErr;

  const { data: enrolled, error: eErr } = await supabase
    .from("shared_enrollments")
    .select("phrase_id")
    .eq("user_id", userId)
    .eq("enabled", true);
  if (eErr) throw eErr;

  let shared = [];
  const ids = (enrolled || []).map((r) => r.phrase_id);
  if (ids.length) {
    const { data, error } = await supabase
      .from("phrases")
      .select("id, text, takes(seq, pose)")
      .in("id", ids)
      .eq("lang", lang);
    if (error) throw error;
    shared = data || [];
  }

  return {
    templates: [...(personal || []), ...shared].map(toTemplate).filter(Boolean),
    log: [],
  };
}

function toTemplate(row) {
  if (!row?.text) return null;
  const takes = (row.takes || [])
    .map((t) => ({ seq: t.seq, pose: t.pose || { slot: "front" } }))
    .filter((t) => Array.isArray(t.seq) && t.seq.length);
  if (!takes.length) return null;
  return { id: row.id, text: row.text, takes };
}

// ------------------------------------------------------- personal training
export async function upsertPersonalPhrase(userId, lang, text) {
  const clean = String(text || "").trim();
  if (!clean) throw new Error("empty-phrase");
  const { data: existing } = await supabase
    .from("phrases")
    .select("id")
    .eq("owner", userId)
    .eq("lang", lang)
    .eq("scope", "personal")
    .ilike("text", clean)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data, error } = await supabase
    .from("phrases")
    .insert({ owner: userId, lang, text: clean, scope: "personal", status: "approved", visibility: "private" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function addTake(userId, phraseId, seq, pose, quality) {
  const { data, error } = await supabase
    .from("takes")
    .insert({ owner: userId, phrase_id: phraseId, seq, pose: pose || { slot: "front" }, quality: quality || null })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function deletePhrase(userId, phraseId) {
  const { error } = await supabase.from("phrases").delete().eq("id", phraseId).eq("owner", userId);
  if (error) throw error;
}

export async function renamePhrase(userId, phraseId, text) {
  const { error } = await supabase.from("phrases").update({ text }).eq("id", phraseId).eq("owner", userId);
  if (error) throw error;
}

export async function logEvent(userId, phraseId, action, meta) {
  if (!cloudEnabled || !userId) return;
  await supabase.from("training_history").insert({ user_id: userId, phrase_id: phraseId || null, action, meta: meta || null });
}

// ------------------------------------------------------- settings
export async function fetchSettings(userId) {
  if (!cloudEnabled || !userId) return null;
  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveSettings(userId, patch) {
  if (!cloudEnabled || !userId) return;
  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) throw error;
}

// ------------------------------------------------------- voice profiles
export async function listVoiceProfiles(userId) {
  if (!cloudEnabled || !userId) return [];
  const { data, error } = await supabase
    .from("voice_profiles")
    .select("id, name, storage_path, donor, is_applied, created_at")
    .eq("owner", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveVoiceProfile(userId, name, blob, donor) {
  const id = crypto.randomUUID();
  const path = `${userId}/${id}.webm`;
  const { error: upErr } = await supabase.storage
    .from(RECORDINGS_BUCKET)
    .upload(path, blob, { contentType: blob.type || "audio/webm", upsert: false });
  if (upErr) throw upErr;

  await supabase.from("voice_profiles").update({ is_applied: false }).eq("owner", userId).eq("is_applied", true);
  const { data, error } = await supabase
    .from("voice_profiles")
    .insert({ id, owner: userId, name, storage_path: path, donor: donor || null, is_applied: true })
    .select("id, name, storage_path, donor, is_applied, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function loadVoiceBlob(storagePath) {
  const { data, error } = await supabase.storage.from(RECORDINGS_BUCKET).download(storagePath);
  if (error) throw error;
  return data;
}

export async function applyVoiceProfile(userId, id) {
  await supabase.from("voice_profiles").update({ is_applied: false }).eq("owner", userId).eq("is_applied", true);
  const { error } = await supabase.from("voice_profiles").update({ is_applied: true }).eq("id", id).eq("owner", userId);
  if (error) throw error;
}

export async function deleteVoiceProfile(userId, id) {
  const { data } = await supabase.from("voice_profiles").select("storage_path").eq("id", id).eq("owner", userId).maybeSingle();
  if (data?.storage_path) await supabase.storage.from(RECORDINGS_BUCKET).remove([data.storage_path]);
  const { error } = await supabase.from("voice_profiles").delete().eq("id", id).eq("owner", userId);
  if (error) throw error;
}

// ------------------------------------------------------- shared training
export async function contributeToShared(userId, phraseId) {
  const { error } = await supabase
    .from("phrases")
    .update({ scope: "shared", status: "pending", visibility: "public", contributed_by: userId })
    .eq("id", phraseId)
    .eq("owner", userId);
  if (error) throw error;
}

export async function listSharedPhrases(lang) {
  let q = supabase
    .from("phrases")
    .select("id, text, lang, contributed_by, takes(id)")
    .eq("scope", "shared")
    .eq("status", "approved")
    .eq("visibility", "public");
  if (lang) q = q.eq("lang", lang);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((p) => ({ id: p.id, text: p.text, lang: p.lang, takeCount: (p.takes || []).length }));
}

export async function listSharedQueue() {
  const { data, error } = await supabase
    .from("phrases")
    .select("id, text, lang, status, contributed_by, created_at")
    .eq("scope", "shared")
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function moderateShared(phraseId, approve, note) {
  const { error } = await supabase
    .from("phrases")
    .update({ status: approve ? "approved" : "rejected", review_note: note || null })
    .eq("id", phraseId);
  if (error) throw error;
}

export async function listEnrollments(userId) {
  if (!cloudEnabled || !userId) return [];
  const { data, error } = await supabase.from("shared_enrollments").select("phrase_id, enabled").eq("user_id", userId);
  if (error) throw error;
  return data || [];
}

export async function setEnrollment(userId, phraseId, enabled) {
  const { error } = await supabase
    .from("shared_enrollments")
    .upsert({ user_id: userId, phrase_id: phraseId, enabled }, { onConflict: "user_id,phrase_id" });
  if (error) throw error;
}
