/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/api/ask/route.ts
// Nerion ASK Route — v6.2 (modifié, attente bloquante du statut + suppression current_index)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { buildSystemPrompt } from "../../../lib/prompts/system";
import { storeInShort } from "../../../lib/memory";

import { getBigFiveQuestion, BIG_FIVE_QUESTIONS } from "../../../lib/prompts/psychometry/big_five";
import {
  getIRIQuestion,
  IRI_QUESTIONS,
  ensureIRIRow,
  getIRIRow,
  findCurrentIndexIRI,
} from "../../../lib/prompts/psychometry/iri";
import { getEcrRQuestion, ECR_R_QUESTIONS } from "../../../lib/prompts/psychometry/ecr_r";
import { getPvqQuestion, PVQ_QUESTIONS } from "../../../lib/prompts/psychometry/pvq_40";

/* =========================
 * Types
 * =======================*/
type ImagePart = { type: "image_url"; image_url: { url: string } };
type TextPart = { type: "text"; text: string };
type ChatContentPart = ImagePart | TextPart;

type Msg = { role: "system" | "user" | "assistant"; content: string };
type QKey = `q${number}`;

type BigFiveRow = {
  user_id: string;
  is_complete?: boolean;
  [key: `q${number}`]: number | null | undefined;
};

type IRIRow = {
  user_id: string;
  is_complete?: boolean;
  [key: `q${number}`]: number | null | undefined;
};

type EcrRRow = {
  user_id: string;
  is_complete?: boolean;
  [key: `q${number}`]: number | null | undefined;
};

type PvqRow = {
  user_id: string;
  is_complete?: boolean;
  [key: `q${number}`]: number | null | undefined;
};

type MemoriesContentOnly = { content: string };
type MemoryRow = { role: string; content: string; created_at: string };

interface AskBody {
  message?: string;
  assistant_message?: string;
  content?: ChatContentPart[]; // vision-style parts
}

/* =========================
 * OpenAI client
 * =======================*/
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

/* =========================
 * Constants / helpers
 * =======================*/
const SCALE_MAX = { big_five: 5, iri: 5, ecr_r: 7, pvq_40: 6 } as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function reverse(n: number, max: number) {
  return max + 1 - n;
}

function hasTriggerOrchestrator(s: string | undefined): boolean {
  if (!s) return false;
  return /"trigger_orchestrator"\s*:\s*true/i.test(s);
}
function hasTriggerPhotoUserTrue(s?: string) {
  return !!s && /\{\s*"trigger"\s*:\s*"TriggerPhotoUserTrue"\s*\}/i.test(s);
}
function hasTriggerUserTrue(s?: string) {
  return !!s && /\{\s*"trigger"\s*:\s*"TriggerUserTrue"\s*\}/i.test(s);
}
function hasFaceScannerTrigger(s?: string) {
  return !!s && /"trigger"\s*:\s*"FaceScannerTrigger"/i.test(s);
}

/** Strip-only helper pour n'envoyer au front QUE du lisible (0 fallback texte) */
function visibleOnly(raw?: string | null): string {
  return stripTechnicalBlocks(String(raw ?? "")).trim();
}

/**
 * Supprime uniquement les blocs techniques (code, JSON de triggers, scores, balises techniques seules)
 * et conserve le texte “humain”.
 */
function stripTechnicalBlocks(text: string): string {
  let cleaned = text ?? "";

  // 1) Supprimer les blocs de code
  cleaned = cleaned
    .replace(/```json[\s\S]*?```/gi, "")
    .replace(/```[\s\S]*?```/gi, "");

  // 2) Supprimer uniquement les objets JSON de trigger
  cleaned = cleaned
    .replace(/\{\s*"?trigger_orchestrator"?\s*:\s*true\s*\}/gi, "")
    .replace(/\{\s*"?trigger"?\s*:\s*"TriggerPhotoUserTrue"\s*\}/gi, "")
    .replace(/\{\s*"?trigger"?\s*:\s*"TriggerUserTrue"\s*\}/gi, "")
    .replace(/\{\s*"?trigger"?\s*:\s*"FaceScannerTrigger"\s*\}/gi, "");

  // 3) Supprimer les artefacts de score
  cleaned = cleaned
    .replace(/\{\s*"?score"?\s*:\s*\d+\s*\}/gi, "")
    .replace(/["']?score["']?\s*[:=]\s*\d+/gi, "")
    .replace(/\[\[\s*SCORE\s*=\s*\d+\s*\]\]/gi, "");

  // 4) Supprimer les balises techniques SEULES sur leur ligne
  cleaned = cleaned
    .replace(/^\s*\[STIMULUS\]\s*$/gim, "")
    .replace(/^\s*\[SYSTEM\]\s*$/gim, "")
    .replace(/^\s*\[PHOTO_PENDING\]\s*$/gim, "")
    .replace(/^\s*\[PHOTO_DONE\]\s*$/gim, "")
    .replace(/^\s*\[AUTO_CONTINUE\]\s*$/gim, "");

  return cleaned.trim();
}

function extractScore(s: string): number | null {
  if (!s) return null;
  const re = /\[\[\s*SCORE\s*=\s*([1-7])\s*\]\]|["']?score["']?\s*:\s*([1-7])/gi;
  let m: RegExpExecArray | null;
  let last: string | undefined;
  while ((m = re.exec(s)) !== null) last = (m[1] || m[2]) as string;
  if (!last) return null;
  const n = parseInt(last, 10);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : null;
}

/* =========================
 * OpenAI call wrapper (+logs)
 * =======================*/
async function callOpenAI(
  messages: any[],
  model?: string,
  temperature = 0.2,
  max_tokens = 400
) {
  const chosen = model || process.env.NERION_OPENAI_MODEL || "gpt-4o";
  console.log("🧠 [GPT CALL] model:", chosen, "temp:", temperature, "max_tokens:", max_tokens);
  console.log("🧠 [GPT CALL] messages:", JSON.stringify(messages, null, 2));
  const completion = await openai.chat.completions.create({
    model: chosen,
    messages: messages as any,
    temperature,
    max_tokens,
  });
  const out = completion?.choices?.[0]?.message?.content?.trim() || "";
  console.log("📩 [GPT RESPONSE] raw:", out);
  return out;
}

/* =========================
 * DB helpers (Big Five / IRI / ECR-R / PVQ)
 * =======================*/
async function ensureBigFiveRow(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("big_five")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    const { error } = await supabase.from("big_five").insert({ user_id: userId });
    if (error) throw error;
  }
}
async function getBigFiveRow(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from("big_five")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as BigFiveRow) ?? null;
}
function findCurrentIndexBigFive(row: BigFiveRow | null): number {
  for (let i = 1; i <= 18; i++) {
    const key = `q${i}` as QKey;
    if (!row || row[key] == null) return i;
  }
  return 19;
}
function isBigFiveFullyFilled(row: BigFiveRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 18; i++) {
    const key = `q${i}` as QKey;
    if (row[key] == null) return false;
  }
  return true;
}
function isIRIFullyFilled(row: IRIRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 28; i++) {
    const key = `q${i}` as QKey;
    if (row[key] == null) return false;
  }
  return true;
}
async function ensureECRRRow(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("ecr_r")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    await supabase.from("ecr_r").insert({ user_id: userId });
  }
}
async function getECRRRow(supabase: SupabaseClient, userId: string): Promise<EcrRRow | null> {
  const { data, error } = await supabase
    .from("ecr_r")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as EcrRRow) ?? null;
}
function findCurrentIndexECRR(row: EcrRRow | null): number {
  for (let i = 1; i <= 36; i++) {
    const key = `q${i}` as QKey;
    if (!row || row[key] == null) return i;
  }
  return 37;
}
function isECRRFullyFilled(row: EcrRRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 36; i++) {
    const key = `q${i}` as QKey;
    if (row[key] == null) return false;
  }
  return true;
}
async function ensurePvqRow(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("pvq_40")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    await supabase.from("pvq_40").insert({ user_id: userId });
  }
}
async function getPvqRow(supabase: SupabaseClient, userId: string): Promise<PvqRow | null> {
  const { data, error } = await supabase
    .from("pvq_40")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as PvqRow) ?? null;
}
function findCurrentIndexPvq(row: PvqRow | null): number {
  for (let i = 1; i <= 40; i++) {
    const key = `q${i}` as QKey;
    if (!row || row[key] == null) return i;
  }
  return 41;
}
function isPvqFullyFilled(row: PvqRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 40; i++) {
    const key = `q${i}` as QKey;
    if (row[key] == null) return false;
  }
  return true;
}

/* =========================
 * Memory helpers
 * =======================*/
async function getShortHistoryBounded(supabase: SupabaseClient, userId: string): Promise<Msg[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .eq("layer", "short")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as unknown as MemoryRow[]).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

async function getLastStimulus(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("memories")
    .select("content")
    .eq("user_id", userId)
    .eq("layer", "short")
    .eq("role", "assistant")
    .ilike("content", "[STIMULUS]%")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const raw = (data[0] as unknown as MemoriesContentOnly).content;
  const stim = raw.replace(/^\[STIMULUS\]\s*\n?/, "").trim();
  return stim || null;
}

/* =========================
 * PHOTO flow helpers
 * =======================*/

// État de flux basé sur les tags en mémoire (compat)
async function getPhotoFlowState(
  supabase: SupabaseClient,
  userId: string
): Promise<"pending" | "done" | null> {
  const { data, error } = await supabase
    .from("memories")
    .select("content")
    .eq("user_id", userId)
    .eq("layer", "short")
    .eq("role", "assistant")
    .or("content.ilike.[PHOTO_PENDING]%,content.ilike.[PHOTO_DONE]%")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const c = (data[0] as any).content || "";
  if (/^\[PHOTO_PENDING\]/i.test(c)) return "pending";
  if (/^\[PHOTO_DONE\]/i.test(c)) return "done";
  return null;
}

// Récupérer la dernière URL image postée par CE user depuis la mémoire
function extractImageUrlFromMarkdown(md: string): string | null {
  const m = (md || "").match(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/);
  return m ? m[1] : null;
}
async function getLastUserImageUrlFromMemory(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("memories")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .eq("layer", "short")
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data) return null;

  for (const row of data as any[]) {
    if (row?.role === "user") {
      const url = extractImageUrlFromMarkdown(row?.content ?? "");
      if (url) return url;
    }
  }
  return null;
}

// fallback ultime: liste du bucket TEMP
async function getLastTemporaryImageUrlFromBucket(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data: files, error } = await supabase.storage
    .from("temporary")
    .list("chat_images", {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" }
    });

  if (error || !files || files.length === 0) return null;

  const latest = files[0];
  const fullPath = `chat_images/${latest.name}`;
  const { data } = supabase.storage.from("temporary").getPublicUrl(fullPath);
  console.log("🗂️ [TEMP] latest file:", fullPath);
  console.log("🔗 [TEMP] public URL:", data?.publicUrl);
  return data?.publicUrl ?? null;
}

function parsePublicStorageUrl(url: string) {
  const marker = "/storage/v1/object/public/";
  const i = url.indexOf(marker);
  if (i === -1) return null;

  const rest = url.slice(i + marker.length);
  const [bucket, ...parts] = rest.split("/");
  if (!bucket || parts.length === 0) return null;

  const encodedPath = parts.join("/");
  const path = decodeURIComponent(encodedPath);
  return { bucket, path };
}
function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".heic")) return "image/heic";
  return "application/octet-stream";
}

/**
 * Copie depuis 'temporary' vers bucket cible.
 * ➕ Insère (idempotent) une ligne dans `public.photos` avec status = 'pending'.
 */
async function moveFromTemporaryToBucket(
  supabase: SupabaseClient,
  publicUrl: string,
  destBucket: "photos_user",
  userId: string
): Promise<{ destPath: string } | null> {
  const parsed = parsePublicStorageUrl(publicUrl);
  if (!parsed || parsed.bucket !== "temporary") {
    console.warn("moveFromTemporaryToBucket: URL not from 'temporary', skip:", publicUrl);
    return null;
  }

  const srcPath = parsed.path;
  const fileName = srcPath.split("/").pop() || `file_${Date.now()}`;
  const destPath = srcPath;

  console.log("📥 [MOVE] downloading from 'temporary':", srcPath);
  const { data: blob, error: dlErr } = await supabase.storage.from("temporary").download(srcPath);
  if (dlErr || !blob) {
    console.error("❌ [MOVE] download error (temporary):", dlErr?.message);
    return null;
  }

  const contentType = guessMimeFromName(fileName);
  console.log("⬆️ [MOVE] uploading to", destBucket, "destPath:", destPath, "contentType:", contentType);
  const { error: upErr } = await supabase.storage
    .from(destBucket)
    .upload(destPath, blob, { contentType, upsert: true });
  if (upErr) {
    console.error("❌ [MOVE] upload error (dest):", upErr.message);
    return null;
  }

  // Insertion idempotente dans public.photos (status=pending)
  try {
    const { data: existing, error: selErr } = await supabase
      .from("photos")
      .select("id")
      .eq("user_id", userId)
      .eq("path", destPath)
      .maybeSingle();

    if (selErr) {
      console.warn("⚠️ [DB SELECT photos] error:", selErr.message);
    }

    if (!existing?.id) {
      const ins = await supabase.from("photos").insert({
        user_id: userId,
        path: destPath,
        photo: "self",
        vectorized: false,
        status: "pending",
      });
      if (ins.error) {
        console.warn("⚠️ [DB INSERT photos] error:", ins.error.message);
      } else {
        console.log("✅ [DB INSERT photos] created for", destPath);
      }
    } else {
      console.log("ℹ️ [DB INSERT photos] skipped (already exists) for", destPath);
    }
  } catch (err) {
    console.error("❌ [DB INSERT photos] exception:", err);
  }

  console.log("✅ [MOVE] completed. destPath:", destPath);
  return { destPath };
}

/** Récupère le dernier status photo pour cet user (confirmed / rejected / duplicate) */
async function getLatestPhotoStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<"confirmed" | "rejected" | "duplicate" | null> {
  const { data, error } = await supabase
    .from("photos")
    .select("status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Erreur récupération photo status:", error);
    return null;
  }
  const s = (data?.status || "").toLowerCase();
  if (s === "confirmed" || s === "rejected" || s === "duplicate") return s;
  return null;
}

/** Mapping: status → tag technique (pour le GPT payload utilisateur) */
function statusToUserPayloadTag(status: "confirmed" | "rejected" | "duplicate" | null): string {
  if (status === "confirmed") return "[PHOTO_STATUS_CONFIRMED]";
  if (status === "rejected") return "[PHOTO_STATUS_REJECTED]";
  if (status === "duplicate") return "[PHOTO_STATUS_DUPLICATE]";
  return "[AUTO_CONTINUE]";
}

/** 🔁 Attente bloquante (sans timeout) du statut final côté backend */
async function waitUntilPhotoIsReady(
  supabase: SupabaseClient,
  userId: string,
  intervalMs = 1000
): Promise<"confirmed" | "rejected" | "duplicate"> {
  while (true) {
    const status = await getLatestPhotoStatus(supabase, userId);
    if (status === "confirmed" || status === "rejected" || status === "duplicate") {
      console.log("✅ [WAIT STATUS] ready:", status);
      return status;
    }
    console.log("⏳ [WAIT STATUS] still pending...");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Construit les "parts" pour la phase photo_user — image depuis la MÉMOIRE user en priorité */
async function buildPhotoUserContentParts(
  supabase: SupabaseClient,
  userId: string,
  opts?: {
    latestTempUrl?: string | null;
    userText?: string | null;
    includeAutoContinue?: boolean;
    statusTag?: string | null; // injection du tag de statut
  }
): Promise<ChatContentPart[]> {
  const parts: ChatContentPart[] = [];

  const latestTemp =
    opts?.latestTempUrl
    ?? (await getLastUserImageUrlFromMemory(supabase, userId))
    ?? (await getLastTemporaryImageUrlFromBucket(supabase));

  if (latestTemp) {
    parts.push({ type: "image_url", image_url: { url: latestTemp } });
    console.log("🧷 [GPT PAYLOAD] image attached:", latestTemp);
  }

  const text = (opts?.userText ?? "").trim();
  if (text) {
    parts.push({ type: "text", text });
  }

  if (opts?.statusTag) {
    parts.push({ type: "text", text: opts.statusTag });
  } else if (opts?.includeAutoContinue) {
    parts.push({ type: "text", text: "[AUTO_CONTINUE]" });
  }

  return parts;
}

/** Kick-off photo_user (system + mémoire, pas d'attente ici) */
async function startPhotoUserPhase(
  supabase: SupabaseClient,
  userId: string
): Promise<string> {
  await storeInShort(supabase, userId, "assistant", `[STIMULUS]\nphoto_user_phase_start`);

  const shortMemory = await getShortHistoryBounded(supabase, userId);

  const messages: any[] = [
    { role: "system", content: buildSystemPrompt({ phase: "photo_user" }) },
    ...shortMemory,
    { role: "user", content: "[AUTO_CONTINUE]" },
  ];

  console.log("🟢 [START PHOTO_USER] messages:", JSON.stringify(messages, null, 2));
  const out = await callOpenAI(messages, undefined, 0.2, 380);
  const clean = stripTechnicalBlocks(out);
  if (clean) {
    console.log("✅ [MEMORY STORED - START PHOTO_USER]:", clean);
    await storeInShort(supabase, userId, "assistant", clean);
  }
  return clean || out;
}

/* =========================
 * Route
 * =======================*/
export async function POST(req: Request) {
  try {
    // ---- Auth ----
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Unauthorized: no token" }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data: authData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !authData?.user?.id) {
      console.error("❌ [AUTH] invalid token or error:", authErr?.message);
      return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 });
    }
    const userId = authData.user.id;
    console.log("🔐 [AUTH] userId:", userId);

    // Ensure base tables exist
    await ensureBigFiveRow(supabase, userId);
    let bfRowAtStart = await getBigFiveRow(supabase, userId);
    let bigFiveComplete = bfRowAtStart?.is_complete === true;
    if (!bigFiveComplete && isBigFiveFullyFilled(bfRowAtStart)) {
      const { error } = await supabase.from("big_five").update({ is_complete: true }).eq("user_id", userId);
      if (!error) {
        bigFiveComplete = true;
        bfRowAtStart = await getBigFiveRow(supabase, userId);
      }
    }

    // ---- Parse body ----
    const rawBody = (await req.json()) as unknown;
    const body = rawBody as AskBody;
    console.log("📥 [REQUEST BODY]:", JSON.stringify(body, null, 2));

    const rawMessage: string | undefined =
      typeof body.message === "string" ? body.message.trim() : undefined;

    const assistantMessageFromClient: string | undefined =
      typeof body.assistant_message === "string" ? body.assistant_message.trim() : undefined;

    const rawContent: ChatContentPart[] | undefined = Array.isArray(body.content) ? body.content : undefined;

    // Detect image(s) presence in content
    const imageParts = (rawContent || []).filter(
      (p): p is ImagePart => (p as ImagePart).type === "image_url" && !!(p as ImagePart).image_url?.url
    );
    const hasImage = imageParts.length > 0;
    const firstImageUrl = imageParts[0]?.image_url?.url;

    const composedUserInput = typeof rawMessage === "string" && rawMessage.length > 0 ? rawMessage : "";
    console.log("🧾 [USER INPUT] text:", composedUserInput, "hasImage:", hasImage, "firstImageUrl:", firstImageUrl);

    // ---- Persist into memories (user) & copier TEMP → photos_user (pending)
    if (hasImage && firstImageUrl) {
      const md = `![Image](${firstImageUrl})`;
      console.log("📝 [MEMORY WRITE] user image markdown:", md);
      await storeInShort(supabase, userId, "user", md);
      // Copie immédiate + insertion DB (status=pending) via moveFromTemporaryToBucket
      await moveFromTemporaryToBucket(supabase, firstImageUrl, "photos_user", userId);

      // Marque le flux comme en attente
      await storeInShort(supabase, userId, "assistant", "[PHOTO_PENDING]");
    }
    if (composedUserInput) {
      console.log("📝 [MEMORY WRITE] user text:", composedUserInput);
      await storeInShort(supabase, userId, "user", composedUserInput);
    }

    /* ===========================================================
     * 1) Trigger from INTRO to FACE SCAN / PHOTO_USER
     * =========================================================*/
    if (assistantMessageFromClient && hasFaceScannerTrigger(assistantMessageFromClient)) {
      console.log("🎯 [TRIGGER] FaceScannerTrigger (assistant_message) → renvoi direct au front");
      return NextResponse.json({ message: '{"trigger":"FaceScannerTrigger"}' });
    }

    if (assistantMessageFromClient && hasTriggerPhotoUserTrue(assistantMessageFromClient)) {
      const visible = stripTechnicalBlocks(assistantMessageFromClient);
      if (visible) {
        console.log("🟢 [TRIGGER: TriggerPhotoUserTrue] visible assistant msg:", visible);
        await storeInShort(supabase, userId, "assistant", visible);
      }

      const kickoff = await startPhotoUserPhase(supabase, userId);
      return NextResponse.json({ message: visibleOnly(kickoff) });
    }

    /* ===========================================================
     * 2) PHOTO_USER: immediate reaction to image uploads (user sent image)
     *    - Bloque jusqu’au statut final (confirmed/rejected/duplicate)
     *    - Puis tague le GPT-CALL avec le statut réel
     * =========================================================*/
    if (hasImage && firstImageUrl) {
      // Attente bloquante du statut réel
      const readyStatus = await waitUntilPhotoIsReady(supabase, userId);
      const statusTag = statusToUserPayloadTag(readyStatus);

      const shortMemory = await getShortHistoryBounded(supabase, userId);
      const userContent = await buildPhotoUserContentParts(supabase, userId, {
        latestTempUrl: firstImageUrl,
        userText: composedUserInput || null,
        includeAutoContinue: false,
        statusTag, // ← injecte le tag de statut réel
      });

      const messages: any[] = [
        { role: "system", content: buildSystemPrompt({ phase: "photo_user" }) },
        ...shortMemory,
        { role: "user", content: userContent },
      ];

      console.log("🧠 [GPT CALL - PHOTO UPLOAD] messages:", JSON.stringify(messages, null, 2));
      const assistant = await callOpenAI(messages, undefined, 0.2, 400);
      const visibleAssistant = stripTechnicalBlocks(assistant);
      if (visibleAssistant) {
        console.log("✅ [MEMORY STORED - PHOTO UPLOAD]:", visibleAssistant);
        await storeInShort(supabase, userId, "assistant", visibleAssistant);
      }

      // Photo flow terminé (quel que soit le statut) → marquer DONE
      await storeInShort(supabase, userId, "assistant", "[PHOTO_DONE]");

      return NextResponse.json({ message: visibleOnly(assistant) });
    }

    /* ===========================================================
     * 3) PHOTO_USER: si flux 'pending' en mémoire (sans nouvelle image)
     *    - Bloque jusqu’au statut, puis appelle GPT avec tag de statut
     * =========================================================*/
    const photoState = await getPhotoFlowState(supabase, userId);
    if (photoState === "pending") {
      // Attente bloquante
      const readyStatus = await waitUntilPhotoIsReady(supabase, userId);
      const statusTag = statusToUserPayloadTag(readyStatus);

      const shortMemory = await getShortHistoryBounded(supabase, userId);
      let messages: any[];

      if (composedUserInput) {
        const userContent = await buildPhotoUserContentParts(supabase, userId, {
          latestTempUrl: await getLastUserImageUrlFromMemory(supabase, userId),
          userText: composedUserInput,
          includeAutoContinue: false,
          statusTag,
        });
        messages = [
          { role: "system", content: buildSystemPrompt({ phase: "photo_user" }) },
          ...shortMemory,
          { role: "user", content: userContent },
        ];
        console.log("🧠 [GPT CALL - PENDING with USER TEXT] messages:", JSON.stringify(messages, null, 2));
      } else {
        messages = [
          { role: "system", content: buildSystemPrompt({ phase: "photo_user" }) },
          ...shortMemory,
          { role: "user", content: statusTag },
        ];
        console.log("🧠 [GPT CALL - PENDING with STATUS TAG] messages:", JSON.stringify(messages, null, 2));
      }

      const assistant = await callOpenAI(messages, undefined, 0.2, 400);
      const visibleAssistant = stripTechnicalBlocks(assistant);
      if (visibleAssistant) {
        console.log("✅ [MEMORY STORED - PENDING FLOW]:", visibleAssistant);
        await storeInShort(supabase, userId, "assistant", visibleAssistant);
      }

      await storeInShort(supabase, userId, "assistant", "[PHOTO_DONE]");
      return NextResponse.json({ message: visibleOnly(assistant) });
    }

    // 3-bis) PHOTO_USER: done + user text → inclure l’image (mémoire) + texte, pas d’attente ici
    if (photoState === "done" && composedUserInput) {
      const shortMemory = await getShortHistoryBounded(supabase, userId);
      const userContent = await buildPhotoUserContentParts(supabase, userId, {
        latestTempUrl: await getLastUserImageUrlFromMemory(supabase, userId),
        userText: composedUserInput,
        includeAutoContinue: false,
      });

      const messages: any[] = [
        { role: "system", content: buildSystemPrompt({ phase: "photo_user" }) },
        ...shortMemory,
        { role: "user", content: userContent },
      ];

      console.log("🧠 [GPT CALL - PHOTO_USER DONE + USER TEXT] messages:", JSON.stringify(messages, null, 2));
      const assistant = await callOpenAI(messages, undefined, 0.2, 400);
      const visibleAssistant = stripTechnicalBlocks(assistant);

      if (visibleAssistant) {
        console.log("✅ [MEMORY STORED - PHOTO_USER DONE]:", visibleAssistant);
        await storeInShort(supabase, userId, "assistant", visibleAssistant);
      }
      return NextResponse.json({ message: visibleOnly(assistant) });
    }

    /* ===========================================================
     * 4) LEGACY orchestrator (Big Five start)
     * =========================================================*/
    if (assistantMessageFromClient && hasTriggerOrchestrator(assistantMessageFromClient)) {
      const enthusiasm = stripTechnicalBlocks(assistantMessageFromClient);
      if (enthusiasm) {
        console.log("🟢 [TRIGGER: trigger_orchestrator] enthusiasm:", enthusiasm);
        await storeInShort(supabase, userId, "assistant", enthusiasm);
      }

      const bfRow = await getBigFiveRow(supabase, userId);
      let step = findCurrentIndexBigFive(bfRow);
      if (step > 18) step = 1;

      const q = getBigFiveQuestion(step);
      const stimulus = q.text;
      await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${stimulus}`);

      const sys = buildSystemPrompt({ phase: "big_five", stimulus });
      const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
      const messages: any[] = [{ role: "system", content: sys }, ...historyAll];

      console.log("🧠 [GPT CALL - BIG_FIVE START] messages:", JSON.stringify(messages, null, 2));
      const firstQ = await callOpenAI(messages, undefined, 0.2, 320);
      const firstQClean = stripTechnicalBlocks(firstQ);
      if (firstQClean) {
        console.log("✅ [MEMORY STORED - BIG_FIVE START]:", firstQClean);
        await storeInShort(supabase, userId, "assistant", firstQClean);
      }

      const out = (enthusiasm ? enthusiasm + "\n\n" : "") + (firstQClean || firstQ);
      return NextResponse.json({ message: visibleOnly(out) });
    }

    /* ===========================================================
     * 5) Psychometry pipeline (inchangé)
     * =========================================================*/
    if (bigFiveComplete) {
      // IRI
      await ensureIRIRow(supabase, userId);
      let iriRow = (await getIRIRow(supabase, userId)) as IRIRow | null;
      let iriComplete = iriRow?.is_complete === true;

      if (!iriComplete && isIRIFullyFilled(iriRow)) {
        const { error } = await supabase.from("iri").update({ is_complete: true }).eq("user_id", userId);
        if (!error) {
          iriRow = (await getIRIRow(supabase, userId)) as IRIRow | null;
          iriComplete = true;
        }
      }

      if (!iriComplete) {
        const pendingStimulus = await getLastStimulus(supabase, userId);
        if (!pendingStimulus) {
          let idx = findCurrentIndexIRI(iriRow as IRIRow);
          if (idx > 28) idx = 1;
          const iriQ = getIRIQuestion(idx);
          const iriStimulus = iriQ.text;

          await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${iriStimulus}`);

          const iriSys = buildSystemPrompt({ phase: "iri", stimulus: iriStimulus });
          const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
          const messages: any[] = [
            { role: "system", content: iriSys },
            ...historyAll,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];

          console.log("🧠 [GPT CALL - IRI START] messages:", JSON.stringify(messages, null, 2));
          const firstIriQ = await callOpenAI(messages, undefined, 0.2, 320);
          const firstIriQClean = stripTechnicalBlocks(firstIriQ);
          if (firstIriQClean) {
            console.log("✅ [MEMORY STORED - IRI START]:", firstIriQClean);
            await storeInShort(supabase, userId, "assistant", firstIriQClean);
          }

          return NextResponse.json({ message: visibleOnly(firstIriQ) });
        }
      } else {
        // ECR-R
        await ensureECRRRow(supabase, userId);
        let ecrRow = await getECRRRow(supabase, userId);
        let ecrComplete = ecrRow?.is_complete === true;

        if (!ecrComplete && isECRRFullyFilled(ecrRow)) {
          const { error } = await supabase.from("ecr_r").update({ is_complete: true }).eq("user_id", userId);
          if (!error) {
            ecrRow = await getECRRRow(supabase, userId);
            ecrComplete = true;
          }
        }

        if (!ecrComplete) {
          const pendingStimulus = await getLastStimulus(supabase, userId);
          if (!pendingStimulus) {
            let eIdx = findCurrentIndexECRR(ecrRow as EcrRRow);
            if (eIdx > 36) eIdx = 1;
            const ecrQ = getEcrRQuestion(eIdx);
            const ecrStimulus = ecrQ.text;

            await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${ecrStimulus}`);

            const ecrSys = buildSystemPrompt({ phase: "ecr_r", stimulus: ecrStimulus });
            const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
            const messages: any[] = [
              { role: "system", content: ecrSys },
              ...historyAll,
              { role: "user", content: "[AUTO_CONTINUE]" },
            ];

            console.log("🧠 [GPT CALL - ECR_R START] messages:", JSON.stringify(messages, null, 2));
            const firstEcrQ = await callOpenAI(messages, undefined, 0.2, 320);
            const firstEcrQClean = stripTechnicalBlocks(firstEcrQ);
            if (firstEcrQClean) {
              console.log("✅ [MEMORY STORED - ECR_R START]:", firstEcrQClean);
              await storeInShort(supabase, userId, "assistant", firstEcrQClean);
            }

            return NextResponse.json({ message: visibleOnly(firstEcrQ) });
          }
        } else {
          // PVQ-40
          await ensurePvqRow(supabase, userId);
          let pvqRow = await getPvqRow(supabase, userId);
          let pvqComplete = pvqRow?.is_complete === true;

          if (!pvqComplete && isPvqFullyFilled(pvqRow)) {
            const { error } = await supabase.from("pvq_40").update({ is_complete: true }).eq("user_id", userId);
            if (!error) {
              pvqRow = await getPvqRow(supabase, userId);
              pvqComplete = true;
            }
          }

          if (!pvqComplete) {
            const pendingStimulus = await getLastStimulus(supabase, userId);
            if (!pendingStimulus) {
              let pIdx = findCurrentIndexPvq(pvqRow as PvqRow);
              if (pIdx > 40) pIdx = 1;
              const pvqQ = getPvqQuestion(pIdx);
              const pvqStimulus = pvqQ.text;

              await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${pvqStimulus}`);

              const pvqSys = buildSystemPrompt({ phase: "pvq_40", stimulus: pvqStimulus });
              const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
              const messages: any[] = [
                { role: "system", content: pvqSys },
                ...historyAll,
                { role: "user", content: "[AUTO_CONTINUE]" },
              ];

              console.log("🧠 [GPT CALL - PVQ START] messages:", JSON.stringify(messages, null, 2));
              const firstPvqQ = await callOpenAI(messages, undefined, 0.2, 320);
              const firstPvqQClean = stripTechnicalBlocks(firstPvqQ);
              if (firstPvqQClean) {
                console.log("✅ [MEMORY STORED - PVQ START]:", firstPvqQClean);
                await storeInShort(supabase, userId, "assistant", firstPvqQClean);
              }

              return NextResponse.json({ message: visibleOnly(firstPvqQ) });
            }
          } else {
            const sys = buildSystemPrompt({ phase: "complete" });
            const history = await getShortHistoryBounded(supabase, userId);
            const messages: any[] = [
              { role: "system", content: sys },
              ...history,
              { role: "user", content: "[AUTO_CONTINUE]" },
            ];
            console.log("🧠 [GPT CALL - COMPLETE PHASE] messages:", JSON.stringify(messages, null, 2));
            const reply = await callOpenAI(messages, undefined, 0.2, 280);
            const cleaned = stripTechnicalBlocks(reply);
            if (cleaned) {
              console.log("✅ [MEMORY STORED - COMPLETE PHASE]:", cleaned);
              await storeInShort(supabase, userId, "assistant", cleaned);
            }
            return NextResponse.json({ message: visibleOnly(reply) });
          }
        }
      }
    }

    /* ===========================================================
     * 6) If a psychometry stimulus is in-flight, continue it (unchanged)
     * =========================================================*/
    const pendingStimulus = await getLastStimulus(supabase, userId);
    if (pendingStimulus) {
      const s = (pendingStimulus || "").trim();
      const bMatch = BIG_FIVE_QUESTIONS.find((q) => q.text === s);
      const iMatch = IRI_QUESTIONS.find((q) => q.text === s);
      const eMatch = ECR_R_QUESTIONS.find((q) => q.text === s);
      const pMatch = PVQ_QUESTIONS.find((q) => q.text === s);

      if (!bMatch && !iMatch && !eMatch && !pMatch) {
        const sys = buildSystemPrompt({ phase: "big_five", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: any[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - CONTINUE (unknown match)] messages:", JSON.stringify(messages, null, 2));
        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) {
          console.log("✅ [MEMORY STORED - CONTINUE (unknown match)]:", visibleAssistant);
          await storeInShort(supabase, userId, "assistant", visibleAssistant);
        }
        return NextResponse.json({ message: visibleOnly(assistant) });
      }

      if (bMatch) {
        const sys = buildSystemPrompt({ phase: "big_five", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: any[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - BIG_FIVE CONTINUE] messages:", JSON.stringify(messages, null, 2));
        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) {
          console.log("✅ [MEMORY STORED - BIG_FIVE CONTINUE]:", visibleAssistant);
          await storeInShort(supabase, userId, "assistant", visibleAssistant);
        }

        if (score == null) {
          return NextResponse.json({ message: visibleOnly(assistant) });
        }

        const row = await getBigFiveRow(supabase, userId);
        if (!row) return NextResponse.json({ error: "big_five missing" }, { status: 500 });

        const targetIndex = bMatch.index ?? findCurrentIndexBigFive(row);
        const qMeta = getBigFiveQuestion(targetIndex);
        const col = qMeta.key as keyof BigFiveRow;

        const sVal = clamp(score, 1, SCALE_MAX.big_five);
        const finalScore = qMeta.isReversed ? reverse(sVal, SCALE_MAX.big_five) : sVal;

        if (row[col] == null) {
          const { error: upErr } = await supabase
            .from("big_five")
            .update({ [col]: finalScore })
            .eq("user_id", userId);
          if (upErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });
        }

        if (targetIndex === 18) {
          const { error: finErr } = await supabase
            .from("big_five")
            .update({ is_complete: true })
            .eq("user_id", userId);
          if (finErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });

          await storeInShort(supabase, userId, "assistant", "✅ Test Big Five terminé. Passons à la suite.");
          await ensureIRIRow(supabase, userId);
          const iriRow = await getIRIRow(supabase, userId);
          let iriIndex = findCurrentIndexIRI(iriRow as IRIRow);
          if (iriIndex > 28) iriIndex = 1;
          const iriQ = getIRIQuestion(iriIndex);
          const iriStimulus = iriQ.text;

          await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${iriStimulus}`);

          const iriSys = buildSystemPrompt({ phase: "iri", stimulus: iriStimulus });
          const nextHistory = await getShortHistoryBounded(supabase, userId);
          const nextMessages: any[] = [
            { role: "system", content: iriSys },
            ...nextHistory,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("🧠 [GPT CALL - IRI After BigFive] messages:", JSON.stringify(nextMessages, null, 2));
          const iriStart = await callOpenAI(nextMessages, undefined, 0.2, 320);
          const iriStartClean = stripTechnicalBlocks(iriStart);
          if (iriStartClean) {
            console.log("✅ [MEMORY STORED - IRI After BigFive]:", iriStartClean);
            await storeInShort(supabase, userId, "assistant", iriStartClean);
          }
          return NextResponse.json({ message: visibleOnly(iriStart) });
        }

        const nextIndex = (bMatch.index ?? 0) + 1;
        const nextMeta = getBigFiveQuestion(nextIndex);
        const nextStimulus = nextMeta.text;
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulus}`);

        const nextSys = buildSystemPrompt({ phase: "big_five", stimulus: nextStimulus });
        const nextHistory = await getShortHistoryBounded(supabase, userId);
        const nextMessages: any[] = [
          { role: "system", content: nextSys },
          ...nextHistory,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - BIG_FIVE Next Q] messages:", JSON.stringify(nextMessages, null, 2));
        const nextQ = await callOpenAI(nextMessages, undefined, 0.2, 320);
        const nextQClean = stripTechnicalBlocks(nextQ);
        if (nextQClean) {
          console.log("✅ [MEMORY STORED - BIG_FIVE Next Q]:", nextQClean);
          await storeInShort(supabase, userId, "assistant", nextQClean);
        }
        return NextResponse.json({ message: visibleOnly(nextQ) });
      }

      if (iMatch) {
        const sys = buildSystemPrompt({ phase: "iri", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: any[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - IRI CONTINUE] messages:", JSON.stringify(messages, null, 2));
        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) {
          console.log("✅ [MEMORY STORED - IRI CONTINUE]:", visibleAssistant);
          await storeInShort(supabase, userId, "assistant", visibleAssistant);
        }

        if (score == null) {
          return NextResponse.json({ message: visibleOnly(assistant) });
        }

        const iriRow2 = (await getIRIRow(supabase, userId)) as IRIRow | null;
        if (!iriRow2) return NextResponse.json({ error: "iri missing" }, { status: 500 });

        const targetIndex = iMatch.index ?? findCurrentIndexIRI(iriRow2);
        const qMeta = getIRIQuestion(targetIndex);
        const col = qMeta.key as keyof IRIRow;

        const sVal = clamp(score, 1, SCALE_MAX.iri);
        const finalScore = qMeta.isReversed ? reverse(sVal, SCALE_MAX.iri) : sVal;

        if (iriRow2[col] == null) {
          const { error: upErr } = await supabase.from("iri").update({ [col]: finalScore }).eq("user_id", userId);
          if (upErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });
        }

        if (targetIndex === 28) {
          const { error: finErr } = await supabase.from("iri").update({ is_complete: true }).eq("user_id", userId);
          if (finErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });

          await storeInShort(supabase, userId, "assistant", "✅ IRI terminé. Passons à la suite.");
          await ensureECRRRow(supabase, userId);
          const ecrRow = await getECRRRow(supabase, userId);
          let ecrIndex = findCurrentIndexECRR(ecrRow as EcrRRow);
          if (ecrIndex > 36) ecrIndex = 1;
          const ecrQ = getEcrRQuestion(ecrIndex);
          const ecrStimulus = ecrQ.text;

          await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${ecrStimulus}`);

          const ecrSys = buildSystemPrompt({ phase: "ecr_r", stimulus: ecrStimulus });
          const nextHistory = await getShortHistoryBounded(supabase, userId);
          const nextMessages: any[] = [
            { role: "system", content: ecrSys },
            ...nextHistory,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("🧠 [GPT CALL - ECR_R After IRI] messages:", JSON.stringify(nextMessages, null, 2));
          const ecrStart = await callOpenAI(nextMessages, undefined, 0.2, 320);
          const ecrStartClean = stripTechnicalBlocks(ecrStart);
          if (ecrStartClean) {
            console.log("✅ [MEMORY STORED - ECR_R After IRI]:", ecrStartClean);
            await storeInShort(supabase, userId, "assistant", ecrStartClean);
          }
          return NextResponse.json({ message: visibleOnly(ecrStart) });
        }

        const nextIndexI = (iMatch.index ?? 0) + 1;
        const nextMetaI = getIRIQuestion(nextIndexI);
        const nextStimulusI = nextMetaI.text;
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulusI}`);

        const nextSysI = buildSystemPrompt({ phase: "iri", stimulus: nextStimulusI });
        const nextHistoryI = await getShortHistoryBounded(supabase, userId);
        const nextMessagesI: any[] = [
          { role: "system", content: nextSysI },
          ...nextHistoryI,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - IRI Next Q] messages:", JSON.stringify(nextMessagesI, null, 2));
        const nextQ = await callOpenAI(nextMessagesI, undefined, 0.2, 320);
        const nextQClean = stripTechnicalBlocks(nextQ);
        if (nextQClean) {
          console.log("✅ [MEMORY STORED - IRI Next Q]:", nextQClean);
          await storeInShort(supabase, userId, "assistant", nextQClean);
        }
        return NextResponse.json({ message: visibleOnly(nextQ) });
      }

      if (eMatch) {
        const sys = buildSystemPrompt({ phase: "ecr_r", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: any[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - ECR_R CONTINUE] messages:", JSON.stringify(messages, null, 2));
        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) {
          console.log("✅ [MEMORY STORED - ECR_R CONTINUE]:", visibleAssistant);
          await storeInShort(supabase, userId, "assistant", visibleAssistant);
        }

        if (score == null) {
          return NextResponse.json({ message: visibleOnly(assistant) });
        }

        const ecrRow2 = (await getECRRRow(supabase, userId)) as EcrRRow | null;
        if (!ecrRow2) return NextResponse.json({ error: "ecr_r missing" }, { status: 500 });

        const targetIndex = eMatch.index ?? findCurrentIndexECRR(ecrRow2);
        const qMeta = getEcrRQuestion(targetIndex);
        const col = qMeta.key as keyof EcrRRow;

        const sVal = clamp(score, 1, SCALE_MAX.ecr_r);
        const finalScore = qMeta.isReversed ? reverse(sVal, SCALE_MAX.ecr_r) : sVal;

        if (ecrRow2[col] == null) {
          const { error: upErr } = await supabase.from("ecr_r").update({ [col]: finalScore }).eq("user_id", userId);
          if (upErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });
        }

        if (targetIndex === 36) {
          const { error: finErr } = await supabase.from("ecr_r").update({ is_complete: true }).eq("user_id", userId);
          if (finErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });
          const doneMsg = "✅ ECR-R terminé. Passons à la suite.";
          await storeInShort(supabase, userId, "assistant", doneMsg);
          await ensurePvqRow(supabase, userId);
          const pvqRow2 = await getPvqRow(supabase, userId);
          let pIdx = findCurrentIndexPvq(pvqRow2 as PvqRow);
          if (pIdx > 40) pIdx = 1;
          const pvqQ = getPvqQuestion(pIdx);
          const pvqStimulus = pvqQ.text;

          await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${pvqStimulus}`);

          const pvqSys = buildSystemPrompt({ phase: "pvq_40", stimulus: pvqStimulus });
          const nextHistory = await getShortHistoryBounded(supabase, userId);
          const nextMessages: any[] = [
            { role: "system", content: pvqSys },
            ...nextHistory,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("🧠 [GPT CALL - PVQ After ECR_R] messages:", JSON.stringify(nextMessages, null, 2));
          const pvqStart = await callOpenAI(nextMessages, undefined, 0.2, 320);
          const pvqStartClean = stripTechnicalBlocks(pvqStart);
          if (pvqStartClean) {
            console.log("✅ [MEMORY STORED - PVQ After ECR_R]:", pvqStartClean);
            await storeInShort(supabase, userId, "assistant", pvqStartClean);
          }
          return NextResponse.json({ message: visibleOnly(pvqStart) });
        }

        const nextIndexE = (eMatch.index ?? 0) + 1;
        const nextMetaE = getEcrRQuestion(nextIndexE);
        const nextStimulusE = nextMetaE.text;
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulusE}`);

        const nextSysE = buildSystemPrompt({ phase: "ecr_r", stimulus: nextStimulusE });
        const nextHistoryE = await getShortHistoryBounded(supabase, userId);
        const nextMessagesE: any[] = [
          { role: "system", content: nextSysE },
          ...nextHistoryE,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - ECR_R Next Q] messages:", JSON.stringify(nextMessagesE, null, 2));
        const nextQE = await callOpenAI(nextMessagesE, undefined, 0.2, 320);
        const nextQCleanE = stripTechnicalBlocks(nextQE);
        if (nextQCleanE) {
          console.log("✅ [MEMORY STORED - ECR_R Next Q]:", nextQCleanE);
          await storeInShort(supabase, userId, "assistant", nextQCleanE);
        }
        return NextResponse.json({ message: visibleOnly(nextQE) });
      }

      if (pMatch) {
        const sys = buildSystemPrompt({ phase: "pvq_40", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: any[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - PVQ CONTINUE] messages:", JSON.stringify(messages, null, 2));
        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) {
          console.log("✅ [MEMORY STORED - PVQ CONTINUE]:", visibleAssistant);
          await storeInShort(supabase, userId, "assistant", visibleAssistant);
        }

        if (score == null) {
          return NextResponse.json({ message: visibleOnly(assistant) });
        }

        const pvqRow2 = (await getPvqRow(supabase, userId)) as PvqRow | null;
        if (!pvqRow2) return NextResponse.json({ error: "pvq_40 missing" }, { status: 500 });

        const targetIndex = pMatch.index ?? findCurrentIndexPvq(pvqRow2);
        const qMeta = getPvqQuestion(targetIndex);
        const col = qMeta.key as keyof PvqRow;

        const sVal = clamp(score, 1, SCALE_MAX.pvq_40);
        const finalScore = qMeta.isReversed ? reverse(sVal, SCALE_MAX.pvq_40) : sVal;

        if (pvqRow2[col] == null) {
          const { error: upErr } = await supabase.from("pvq_40").update({ [col]: finalScore }).eq("user_id", userId);
          if (upErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });
        }

        if (targetIndex === 40) {
          const { error: finErr } = await supabase.from("pvq_40").update({ is_complete: true }).eq("user_id", userId);
          if (finErr) return NextResponse.json({ error: "DB update error" }, { status: 500 });
          const doneMsg = "✅ PVQ-40 terminé. Merci pour ta participation.";
          await storeInShort(supabase, userId, "assistant", doneMsg);
          return NextResponse.json({ message: doneMsg });
        }

        const nextIndexP = (pMatch.index ?? 0) + 1;
        const nextMetaP = getPvqQuestion(nextIndexP);
        const nextStimulusP = nextMetaP.text;
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulusP}`);

        const nextSysP = buildSystemPrompt({ phase: "pvq_40", stimulus: nextStimulusP });
        const nextHistoryP = await getShortHistoryBounded(supabase, userId);
        const nextMessagesP: any[] = [
          { role: "system", content: nextSysP },
          ...nextHistoryP,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🧠 [GPT CALL - PVQ Next Q] messages:", JSON.stringify(nextMessagesP, null, 2));
        const nextQP = await callOpenAI(nextMessagesP, undefined, 0.2, 320);
        const nextQCleanP = stripTechnicalBlocks(nextQP);
        if (nextQCleanP) {
          console.log("✅ [MEMORY STORED - PVQ Next Q]:", nextQCleanP);
          await storeInShort(supabase, userId, "assistant", nextQCleanP);
        }
        return NextResponse.json({ message: visibleOnly(nextQP) });
      }
    }

    /* ===========================================================
     * 7) Fallback intro (unchanged)
     * =========================================================*/
    const sys = buildSystemPrompt({ phase: "intro" });
    const history = await getShortHistoryBounded(supabase, userId);
    const messages: any[] = [
      { role: "system", content: sys },
      ...history,
      { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
    ];

    console.log("🧠 [GPT CALL - INTRO FALLBACK] messages:", JSON.stringify(messages, null, 2));
    const reply = await callOpenAI(messages, undefined, 0.2, 280);

    // Si GPT renvoie FaceScannerTrigger pendant l'intro → on relaie au front
    if (hasFaceScannerTrigger(reply)) {
      const visible = stripTechnicalBlocks(reply);
      if (visible) {
        await storeInShort(supabase, userId, "assistant", visible);
      }
      return NextResponse.json({
        message: (visible ? visible + "\n\n" : "") + '{"trigger":"FaceScannerTrigger"}'
      });
    }

    if (hasTriggerPhotoUserTrue(reply)) {
      const visible = stripTechnicalBlocks(reply);
      if (visible) {
        console.log("🟢 [TRIGGER: TriggerPhotoUserTrue] (fallback) visible:", visible);
        await storeInShort(supabase, userId, "assistant", visible);
      }

      const kickoff = await startPhotoUserPhase(supabase, userId);
      const out = (visible ? visible + "\n\n" : "") + kickoff;
      return NextResponse.json({ message: visibleOnly(out) });
    }

    const cleaned = stripTechnicalBlocks(reply);
    if (cleaned) {
      console.log("✅ [MEMORY STORED - INTRO FALLBACK]:", cleaned);
      await storeInShort(supabase, userId, "assistant", cleaned);
    }
    return NextResponse.json({ message: visibleOnly(reply) });
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { error?: { message?: string } }; status?: number };
      message?: string;
      status?: number;
    };
    console.error("❌ Error in ask route:", e);
    const msg = e?.response?.data?.error?.message || e?.message || "Server error";
    const status = Number(e?.status) || Number(e?.response?.status) || 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
