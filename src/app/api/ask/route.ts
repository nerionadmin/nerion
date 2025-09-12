// src/app/api/ask/route.ts
// Nerion ASK Route — v5.2 (PVQ-40 corrigé, clamp+reverse sécurisés, sanitation stricte affichage)
// - Chaîne complète : Big Five → IRI → ECR-R → PVQ-40
// - Orchestration identique (stimulus, memory, SCORE, reverse scoring, auto-continue)
// - Soft-completion : si toutes les colonnes remplies mais is_complete=false → on flag
// - Typage Msg minimal pour stabilité SDK
// - Mémoire short : TOTALE (pas de limite), injectée à chaque appel GPT

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

import { buildSystemPrompt } from "../../../lib/prompts/system";
import { storeInShort } from "../../../lib/memory";

import { getBigFiveQuestion, BIG_FIVE_QUESTIONS } from "../../../lib/prompts/big_five";
import {
  getIRIQuestion,
  IRI_QUESTIONS,
  ensureIRIRow,
  getIRIRow,
  findCurrentIndexIRI,
} from "../../../lib/prompts/iri";
import { getEcrRQuestion, ECR_R_QUESTIONS } from "../../../lib/prompts/ecr_r";
import { getPvqQuestion, PVQ_QUESTIONS } from "../../../lib/prompts/pvq_40";

import { analyzeImage } from "../../../lib/photo";

// ------------ Types ------------
type ImagePart = { type: "image_url"; image_url: { url: string } };
type TextPart = { type: "text"; text: string };
type ChatContentPart = ImagePart | TextPart;

// Minimal, future‑proof message shape for OpenAI chat.completions
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
  content?: ChatContentPart[];
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// ------------ Helpers ------------

// Echelles par inventaire
const SCALE_MAX = {
  big_five: 5,
  iri: 5,
  ecr_r: 7,
  pvq_40: 6,
} as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function reverse(n: number, max: number) {
  return (max + 1) - n;
}

function detectStartIntent(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return !!t.match(
    /(let'?s\s*(go|begin|start)|\b(start|begin|go)\b|c['’]est parti|on commence|commen[cs]ons|je suis (pr[eé]t|ready)|lance|d[eé]marre|d[eé]butons)/
  );
}

function hasTriggerOrchestrator(s: string | undefined): boolean {
  if (!s) return false;
  return /"trigger_orchestrator"\s*:\s*true/i.test(s);
}

// Sanitation stricte pour ne rien laisser de technique au front
function stripTechnicalBlocks(text: string): string {
  return (text ?? "")
    // Blocs code (json ou non)
    .replace(/```json[\s\S]*?```/gi, "")
    .replace(/```[\s\S]*?```/gi, "")
    // Orchestrator / score (JSON strict ou lâche)
    .replace(/\{\s*"?trigger_orchestrator"?\s*:\s*true\s*\}/gi, "")
    .replace(/\{\s*"?score"?\s*:\s*\d+\s*\}/gi, "")
    .replace(/["']?score["']?\s*[:=]\s*\d+/gi, "")
    // Tokens de score style [[SCORE = 5]]
    .replace(/\[\[\s*SCORE\s*=\s*\d+\s*\]\]/gi, "")
    // En-têtes internes
    .replace(/^\s*\[STIMULUS\][^\n]*\n?/gim, "")
    .replace(/^\s*\[SYSTEM\][^\n]*\n?/gim, "")
    .trim();
}

// Take the *last* score token if multiple are produced
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

async function callOpenAI(
  messages: Msg[],
  model?: string,
  temperature = 0.2,
  max_tokens = 400
) {
  const chosen = model || process.env.NERION_OPENAI_MODEL || "gpt-4o";
  const completion = await openai.chat.completions.create({
    model: chosen,
    messages,
    temperature,
    max_tokens,
  });
  return completion.choices?.[0]?.message?.content?.trim() || "";
}

// ----- Big Five helpers -----
async function ensureBigFiveRow(supabase: SupabaseClient, userId: string) {
  const { data } = await supabase
    .from("big_five")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) {
    console.log("➕ Création big_five row pour", userId);
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

// Return the next empty index; if all filled, return 19 (done)
function findCurrentIndexBigFive(row: BigFiveRow | null): number {
  for (let i = 1; i <= 18; i++) {
    const key = `q${i}` as QKey;
    if (!row || row[key] == null) return i;
  }
  return 19; // tout rempli
}

function isBigFiveFullyFilled(row: BigFiveRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 18; i++) {
    const key = `q${i}` as QKey;
    if (row[key] == null) return false;
  }
  return true;
}

// ----- IRI helpers -----
function isIRIFullyFilled(row: IRIRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 28; i++) {
    const key = `q${i}` as QKey;
    if ((row as any)[key] == null) return false;
  }
  return true;
}

// ----- ECR-R helpers -----
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

async function getECRRRow(
  supabase: SupabaseClient,
  userId: string
): Promise<EcrRRow | null> {
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
  return 37; // test terminé
}

function isECRRFullyFilled(row: EcrRRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 36; i++) {
    const key = `q${i}` as QKey;
    if (row[key] == null) return false;
  }
  return true;
}

// ----- PVQ-40 helpers -----
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

async function getPvqRow(
  supabase: SupabaseClient,
  userId: string
): Promise<PvqRow | null> {
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
  return 41; // test terminé
}

function isPvqFullyFilled(row: PvqRow | null): boolean {
  if (!row) return false;
  for (let i = 1; i <= 40; i++) {
    const key = `q${i}` as QKey;
    if ((row as any)[key] == null) return false;
  }
  return true;
}

// ----- Memories helpers -----

// Full short-history (oldest → newest) — mémoire short TOTALE
async function getShortHistoryBounded(
  supabase: SupabaseClient,
  userId: string
): Promise<Msg[]> {
  const { data, error } = await supabase
    .from("memories")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .eq("layer", "short")
    .order("created_at", { ascending: true }); // oldest → newest
  if (error || !data) return [];
  return (data as unknown as MemoryRow[]).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  }));
}

// Robust: query the last assistant memory that *starts* with [STIMULUS]
async function getLastStimulus(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
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

// Resolve whether a stimulus belongs to Big Five, IRI, ECR-R, or PVQ-40
function resolveStimulusPhaseAndIndex(stimulus: string):
  | { phase: "big_five"; index: number }
  | { phase: "iri"; index: number }
  | { phase: "ecr_r"; index: number }
  | { phase: "pvq_40"; index: number }
  | null {
  const s = (stimulus || "").trim();
  const bMatch = BIG_FIVE_QUESTIONS.find((q) => q.text === s);
  if (bMatch) return { phase: "big_five", index: bMatch.index };
  const iMatch = IRI_QUESTIONS.find((q) => q.text === s);
  if (iMatch) return { phase: "iri", index: iMatch.index };
  const eMatch = ECR_R_QUESTIONS.find((q) => q.text === s);
  if (eMatch) return { phase: "ecr_r", index: eMatch.index };
  const pMatch = PVQ_QUESTIONS.find((q) => q.text === s);
  if (pMatch) return { phase: "pvq_40", index: pMatch.index };
  return null;
}

// ------------ Route ------------
export async function POST(req: Request) {
  try {
    console.log("🔐 Auth...");
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
      return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 });
    }
    const userId = authData.user.id;
    console.log("✅ User:", userId);

    // Ensure rows
    await ensureBigFiveRow(supabase, userId);
    let bfRowAtStart = await getBigFiveRow(supabase, userId);
    let bigFiveComplete = bfRowAtStart?.is_complete === true;

    // Soft-complete (Big Five)
    if (!bigFiveComplete && isBigFiveFullyFilled(bfRowAtStart)) {
      console.log("🟢 Big Five rempli → flag is_complete=true (soft)");
      const { error } = await supabase
        .from("big_five")
        .update({ is_complete: true })
        .eq("user_id", userId);
      if (error) console.warn("⚠️ Soft-complete Big Five update error:", error.message);
      bigFiveComplete = true;
      bfRowAtStart = await getBigFiveRow(supabase, userId);
    }

    // ---- Parse body ----
    const rawBody = (await req.json()) as unknown;
    const body = rawBody as AskBody;

    const rawMessage: string | undefined =
      typeof body.message === "string" ? body.message.trim() : undefined;

    const assistantMessageFromClient: string | undefined =
      typeof body.assistant_message === "string"
        ? body.assistant_message.trim()
        : undefined;

    const rawContent: ChatContentPart[] | undefined = Array.isArray(body.content)
      ? body.content
      : undefined;

    // Compose user input (texte + image décrite)
    let composedUserInput = "";
    const hasImage = !!rawContent?.some(
      (p) => (p as ImagePart).type === "image_url" && (p as ImagePart).image_url?.url
    );
    const firstImageUrl = rawContent?.find(
      (p): p is ImagePart => (p as ImagePart).type === "image_url"
    )?.image_url?.url;

    if (hasImage && firstImageUrl) {
      console.log("🖼️ Image détectée, analyse...");
      const description = await analyzeImage(firstImageUrl);
      composedUserInput = rawMessage
        ? `${rawMessage}\n\n[Image décrite]\n${description}`
        : description;
    } else {
      composedUserInput =
        rawMessage ?? (rawContent as TextPart[])?.map((p) => p.text).join("\n") ?? "";
    }

    console.log("💬 Input user:", composedUserInput || "(vide)");
    if (assistantMessageFromClient)
      console.log("🤝 assistant_message (client):", assistantMessageFromClient);

    // ---- Stocker le message user si présent ----
    if (composedUserInput) await storeInShort(supabase, userId, "user", composedUserInput);

    // ---- Détection d'un trigger envoyé depuis le client (pour démarrer Big Five) ----
    if (assistantMessageFromClient && hasTriggerOrchestrator(assistantMessageFromClient)) {
      console.log("🚀 Trigger orchestrator (depuis assistant_message client)");
      const enthusiasm = stripTechnicalBlocks(assistantMessageFromClient);
      if (enthusiasm) await storeInShort(supabase, userId, "assistant", enthusiasm);

      const bfRow = await getBigFiveRow(supabase, userId);
      let step = findCurrentIndexBigFive(bfRow);
      if (step > 18) step = 1;

      const q = getBigFiveQuestion(step);
      const stimulus = q.text;
      await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${stimulus}`);

      const sys = buildSystemPrompt({ phase: "big_five", stimulus });
      const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
      const messages: Msg[] = [{ role: "system", content: sys }, ...historyAll];

      console.log("🤖 GPT start Q", step);
      const firstQ = await callOpenAI(messages, undefined, 0.2, 320);
      const firstQClean = stripTechnicalBlocks(firstQ);
      await storeInShort(supabase, userId, "assistant", firstQClean || firstQ);

      const out = (enthusiasm ? enthusiasm + "\n\n" : "") + (firstQClean || firstQ);
      return NextResponse.json({ message: out });
    }

    // ---- Démarrage "intro" si intention de commencer (phase intro) ----
    if (detectStartIntent(composedUserInput)) {
      console.log("✅ Intent de démarrer détecté → phase 'intro'");
      const introSys = buildSystemPrompt({ phase: "intro" });
      const introMessages: Msg[] = [
        { role: "system", content: introSys },
        { role: "user", content: composedUserInput },
      ];
      const introReply = await callOpenAI(introMessages, undefined, 0.0, 240);
      console.log("💬 INTRO reply:", introReply);
      const enthusiasm = stripTechnicalBlocks(introReply);
      if (enthusiasm) await storeInShort(supabase, userId, "assistant", enthusiasm);

      if (hasTriggerOrchestrator(introReply)) {
        const bfRow = await getBigFiveRow(supabase, userId);
        let step = findCurrentIndexBigFive(bfRow);
        if (step > 18) step = 1;

        const q = getBigFiveQuestion(step);
        const stimulus = q.text;
        console.log(`📌 Stimulus q${step}:`, stimulus);
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${stimulus}`);

        const sys = buildSystemPrompt({ phase: "big_five", stimulus });
        const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [{ role: "system", content: sys }, ...historyAll];

        console.log("🤖 GPT start Q", step);
        const firstQ = await callOpenAI(messages, undefined, 0.2, 320);
        const firstQClean = stripTechnicalBlocks(firstQ);
        await storeInShort(supabase, userId, "assistant", firstQClean || firstQ);

        const out = (enthusiasm ? enthusiasm + "\n\n" : "") + (firstQClean || firstQ);
        return NextResponse.json({ message: out });
      }

      return NextResponse.json({ message: enthusiasm || introReply });
    }

    // ---- Si Big Five est terminé, continuer sans stimulus en attente ----
    if (bigFiveComplete) {
      await ensureIRIRow(supabase, userId);
      let iriRow = (await getIRIRow(supabase, userId)) as IRIRow | null;
      let iriComplete = iriRow?.is_complete === true;

      // Soft-complete (IRI)
      if (!iriComplete && isIRIFullyFilled(iriRow)) {
        console.log("🟢 IRI rempli → flag is_complete=true (soft)");
        const { error } = await supabase
          .from("iri")
          .update({ is_complete: true })
          .eq("user_id", userId);
        if (error) console.warn("⚠️ Soft-complete IRI update error:", error.message);
        iriRow = (await getIRIRow(supabase, userId)) as IRIRow | null;
        iriComplete = true;
      }

      // Si IRI non complet et aucun stimulus en attente, poser la prochaine question IRI
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
          const messages: Msg[] = [
            { role: "system", content: iriSys },
            ...historyAll,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];

          console.log("🤖 GPT start IRI Q", idx);
          const firstIriQ = await callOpenAI(messages, undefined, 0.2, 320);
          const firstIriQClean = stripTechnicalBlocks(firstIriQ);
          await storeInShort(supabase, userId, "assistant", firstIriQClean || firstIriQ);

          return NextResponse.json({ message: firstIriQClean || firstIriQ });
        }
      } else {
        // IRI complet → vérifier ECR-R
        await ensureECRRRow(supabase, userId);
        let ecrRow = await getECRRRow(supabase, userId);
        let ecrComplete = ecrRow?.is_complete === true;

        // Soft-complete (ECR-R)
        if (!ecrComplete && isECRRFullyFilled(ecrRow)) {
          console.log("🟢 ECR-R rempli → flag is_complete=true (soft)");
          const { error } = await supabase
            .from("ecr_r")
            .update({ is_complete: true })
            .eq("user_id", userId);
          if (error) console.warn("⚠️ Soft-complete ECR-R update error:", error.message);
          ecrRow = await getECRRRow(supabase, userId);
          ecrComplete = true;
        }

        if (!ecrComplete) {
          // Si ECR-R non complet et aucun stimulus, démarrer ECR-R
          const pendingStimulus = await getLastStimulus(supabase, userId);
          if (!pendingStimulus) {
            let eIdx = findCurrentIndexECRR(ecrRow as EcrRRow);
            if (eIdx > 36) eIdx = 1;
            const ecrQ = getEcrRQuestion(eIdx);
            const ecrStimulus = ecrQ.text;

            await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${ecrStimulus}`);

            const ecrSys = buildSystemPrompt({ phase: "ecr_r", stimulus: ecrStimulus });
            const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
            const messages: Msg[] = [
              { role: "system", content: ecrSys },
              ...historyAll,
              { role: "user", content: "[AUTO_CONTINUE]" },
            ];

            console.log("🤖 GPT start ECR-R Q", eIdx);
            const firstEcrQ = await callOpenAI(messages, undefined, 0.2, 320);
            const firstEcrQClean = stripTechnicalBlocks(firstEcrQ);
            await storeInShort(supabase, userId, "assistant", firstEcrQClean || firstEcrQ);

            return NextResponse.json({ message: firstEcrQClean || firstEcrQ });
          }
        } else {
          // ECR-R complet → vérifier / démarrer PVQ-40
          await ensurePvqRow(supabase, userId);
          let pvqRow = await getPvqRow(supabase, userId);
          let pvqComplete = pvqRow?.is_complete === true;

          // Soft-complete (PVQ)
          if (!pvqComplete && isPvqFullyFilled(pvqRow)) {
            console.log("🟢 PVQ-40 rempli → flag is_complete=true (soft)");
            const { error } = await supabase
              .from("pvq_40")
              .update({ is_complete: true })
              .eq("user_id", userId);
            if (error) console.warn("⚠️ Soft-complete PVQ update error:", error.message);
            pvqRow = await getPvqRow(supabase, userId);
            pvqComplete = true;
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
              const messages: Msg[] = [
                { role: "system", content: pvqSys },
                ...historyAll,
                { role: "user", content: "[AUTO_CONTINUE]" },
              ];

              console.log("🤖 GPT start PVQ-40 Q", pIdx);
              const firstPvqQ = await callOpenAI(messages, undefined, 0.2, 320);
              const firstPvqQClean = stripTechnicalBlocks(firstPvqQ);
              await storeInShort(supabase, userId, "assistant", firstPvqQClean || firstPvqQ);

              return NextResponse.json({ message: firstPvqQClean || firstPvqQ });
            }
          } else {
            // Tous tests terminés → phase complete
            console.log("👋 Phase 'complete' (tous tests terminés)");
            const sys = buildSystemPrompt({ phase: "complete" });
            const history = await getShortHistoryBounded(supabase, userId);
            const messages: Msg[] = [
              { role: "system", content: sys },
              ...history,
              { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
            ];
            const reply = await callOpenAI(messages, undefined, 0.2, 280);
            const cleaned = stripTechnicalBlocks(reply);
            await storeInShort(supabase, userId, "assistant", cleaned || reply);
            return NextResponse.json({ message: cleaned || reply });
          }
        }
      }
    }

    // ---- Phase en cours ? (stimulus en attente) → résoudre Big Five / IRI / ECR-R / PVQ-40 ----
    const pendingStimulus = await getLastStimulus(supabase, userId);
    if (pendingStimulus) {
      const resolved = resolveStimulusPhaseAndIndex(pendingStimulus);
      if (!resolved) {
        // Fallback Big Five (sécurité) — pas d’update DB si index inconnu
        console.warn("⚠️ Stimulus non résolu → fallback Big Five (sans écriture DB)");
        const sys = buildSystemPrompt({ phase: "big_five", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
        ];
        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) await storeInShort(supabase, userId, "assistant", visibleAssistant);
        return NextResponse.json({ message: visibleAssistant || assistant });
      }

      if (resolved.phase === "big_five") {
        console.log("🧭 Stimulus en cours → phase 'big_five'");
        const sys = buildSystemPrompt({ phase: "big_five", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
        ];

        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        console.log("💬 BIG5 assistant:", assistant);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) await storeInShort(supabase, userId, "assistant", visibleAssistant);

        if (score == null) {
          console.log("ℹ️ Pas de SCORE détecté → on renvoie la réponse telle quelle");
          return NextResponse.json({ message: visibleAssistant || assistant });
        }

        console.log("🧠 SCORE détecté (Big Five):", score);

        const row = await getBigFiveRow(supabase, userId);
        if (!row) {
          console.error("❌ big_five row introuvable pour user:", userId);
          return NextResponse.json({ error: "big_five missing" }, { status: 500 });
        }

        const targetIndex = resolved.index ?? findCurrentIndexBigFive(row);
        const qMeta = getBigFiveQuestion(targetIndex);
        const col = qMeta.key as keyof BigFiveRow;

        // clamp + reverse (1..5)
        const s = clamp(score, 1, SCALE_MAX.big_five);
        const finalScore = qMeta.isReversed ? reverse(s, SCALE_MAX.big_five) : s;

        if (row[col] != null) {
          console.warn(`⚠️ ${String(col)} already set — skipping overwrite`);
        } else {
          console.log(`📝 Écriture ${String(col)} = ${finalScore} (isReversed=${qMeta.isReversed})`);
          const { error: upErr } = await supabase
            .from("big_five")
            .update({ [col]: finalScore })
            .eq("user_id", userId);
          if (upErr) {
            console.error("❌ Update error:", upErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }
        }

        // Fin de test Big Five ?
        if (targetIndex === 18) {
          console.log("🏁 Q18 atteinte → is_complete = true (Big Five)");
          const { error: finErr } = await supabase
            .from("big_five")
            .update({ is_complete: true })
            .eq("user_id", userId);
          if (finErr) {
            console.error("❌ Flag complete error:", finErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }

          // ➕ Début automatique du test IRI
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
          const nextMessages: Msg[] = [
            { role: "system", content: iriSys },
            ...nextHistory,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("📤 GPT → IRI Q", iriIndex);
          const iriStart = await callOpenAI(nextMessages, undefined, 0.2, 320);
          const iriStartClean = stripTechnicalBlocks(iriStart);
          if (iriStartClean) await storeInShort(supabase, userId, "assistant", iriStartClean);
          return NextResponse.json({ message: iriStartClean || iriStart });
        }

        // Sinon, préparer Qn+1 (Big Five)
        const nextIndex = targetIndex + 1;
        const nextMeta = getBigFiveQuestion(nextIndex);
        const nextStimulus = nextMeta.text;
        console.log(`➡️ Préparation stimulus Big Five q${nextIndex}`);
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulus}`);

        const nextSys = buildSystemPrompt({ phase: "big_five", stimulus: nextStimulus });
        const nextHistory = await getShortHistoryBounded(supabase, userId);
        const nextMessages: Msg[] = [
          { role: "system", content: nextSys },
          ...nextHistory,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("📤 GPT → Big Five Q", nextIndex);
        const nextQ = await callOpenAI(nextMessages, undefined, 0.2, 320);
        const nextQClean = stripTechnicalBlocks(nextQ);
        if (nextQClean) await storeInShort(supabase, userId, "assistant", nextQClean);
        return NextResponse.json({ message: nextQClean || nextQ });
      }

      if (resolved.phase === "iri") {
        console.log("🧭 Stimulus en cours → phase 'iri'");
        const sys = buildSystemPrompt({ phase: "iri", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
        ];

        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        console.log("💬 IRI assistant:", assistant);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) await storeInShort(supabase, userId, "assistant", visibleAssistant);

        if (score == null) {
          console.log("ℹ️ Pas de SCORE détecté (IRI) → on renvoie la réponse telle quelle");
          return NextResponse.json({ message: visibleAssistant || assistant });
        }

        console.log("🧠 SCORE détecté (IRI):", score);

        const iriRow = (await getIRIRow(supabase, userId)) as IRIRow | null;
        if (!iriRow) {
          console.error("❌ iri row introuvable pour user:", userId);
          return NextResponse.json({ error: "iri missing" }, { status: 500 });
        }

        const targetIndex = resolved.index ?? findCurrentIndexIRI(iriRow);
        const qMeta = getIRIQuestion(targetIndex);
        const col = qMeta.key as keyof IRIRow;

        // clamp + reverse (1..5)
        const s = clamp(score, 1, SCALE_MAX.iri);
        const finalScore = qMeta.isReversed ? reverse(s, SCALE_MAX.iri) : s;

        if (iriRow[col] != null) {
          console.warn(`⚠️ ${String(col)} already set — skipping overwrite (IRI)`);
        } else {
          console.log(`📝 (IRI) Écriture ${String(col)} = ${finalScore} (isReversed=${qMeta.isReversed})`);
          const { error: upErr } = await supabase
            .from("iri")
            .update({ [col]: finalScore })
            .eq("user_id", userId);
          if (upErr) {
            console.error("❌ Update error IRI:", upErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }
        }

        // Fin de test IRI ?
        if (targetIndex === 28) {
          console.log("🏁 IRI Q28 atteinte → is_complete = true (IRI)");
          const { error: finErr } = await supabase
            .from("iri")
            .update({ is_complete: true })
            .eq("user_id", userId);
          if (finErr) {
            console.error("❌ Flag complete error (IRI):", finErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }

          // ➕ Début automatique du test ECR-R
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
          const nextMessages: Msg[] = [
            { role: "system", content: ecrSys },
            ...nextHistory,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("📤 GPT → ECR-R Q", ecrIndex);
          const ecrStart = await callOpenAI(nextMessages, undefined, 0.2, 320);
          const ecrStartClean = stripTechnicalBlocks(ecrStart);
          if (ecrStartClean) await storeInShort(supabase, userId, "assistant", ecrStartClean);
          return NextResponse.json({ message: ecrStartClean || ecrStart });
        }

        // Sinon, préparer Qn+1 (IRI)
        const nextIndex = targetIndex + 1;
        const nextMeta = getIRIQuestion(nextIndex);
        const nextStimulus = nextMeta.text;
        console.log(`➡️ Préparation stimulus IRI q${nextIndex}`);
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulus}`);

        const nextSys = buildSystemPrompt({ phase: "iri", stimulus: nextStimulus });
        const nextHistory = await getShortHistoryBounded(supabase, userId);
        const nextMessages: Msg[] = [
          { role: "system", content: nextSys },
          ...nextHistory,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("📤 GPT → IRI Q", nextIndex);
        const nextQ = await callOpenAI(nextMessages, undefined, 0.2, 320);
        const nextQClean = stripTechnicalBlocks(nextQ);
        if (nextQClean) await storeInShort(supabase, userId, "assistant", nextQClean);
        return NextResponse.json({ message: nextQClean || nextQ });
      }

      if (resolved.phase === "ecr_r") {
        // ===== ECR-R branch =====
        console.log("🧭 Stimulus en cours → phase 'ecr_r'");
        const sys = buildSystemPrompt({ phase: "ecr_r", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
        ];

        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        console.log("💬 ECR-R assistant:", assistant);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) await storeInShort(supabase, userId, "assistant", visibleAssistant);

        if (score == null) {
          console.log("ℹ️ Pas de SCORE détecté (ECR-R) → on renvoie la réponse telle quelle");
          return NextResponse.json({ message: visibleAssistant || assistant });
        }

        console.log("🧠 SCORE détecté (ECR-R):", score);

        const ecrRow = (await getECRRRow(supabase, userId)) as EcrRRow | null;
        if (!ecrRow) {
          console.error("❌ ecr_r row introuvable pour user:", userId);
          return NextResponse.json({ error: "ecr_r missing" }, { status: 500 });
        }

        const targetIndex = resolved.index ?? findCurrentIndexECRR(ecrRow);
        const qMeta = getEcrRQuestion(targetIndex);
        const col = qMeta.key as keyof EcrRRow;

        // clamp + reverse (1..7)
        const s = clamp(score, 1, SCALE_MAX.ecr_r);
        const finalScore = qMeta.isReversed ? reverse(s, SCALE_MAX.ecr_r) : s;

        if (ecrRow[col] != null) {
          console.warn(`⚠️ ${String(col)} already set — skipping overwrite (ECR-R)`);
        } else {
          console.log(`📝 (ECR-R) Écriture ${String(col)} = ${finalScore} (isReversed=${qMeta.isReversed})`);
          const { error: upErr } = await supabase
            .from("ecr_r")
            .update({ [col]: finalScore })
            .eq("user_id", userId);
          if (upErr) {
            console.error("❌ Update error ECR-R:", upErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }
        }

        // Fin de test ECR-R ?
        if (targetIndex === 36) {
          console.log("🏁 ECR-R Q36 atteinte → is_complete = true (ECR-R)");
          const { error: finErr } = await supabase
            .from("ecr_r")
            .update({ is_complete: true })
            .eq("user_id", userId);
          if (finErr) {
            console.error("❌ Flag complete error (ECR-R):", finErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }

          // ➕ Début automatique du test PVQ-40
          await storeInShort(supabase, userId, "assistant", "✅ ECR-R terminé. Passons à la suite.");
          await ensurePvqRow(supabase, userId);
          const pvqRow = await getPvqRow(supabase, userId);
          let pIdx = findCurrentIndexPvq(pvqRow as PvqRow);
          if (pIdx > 40) pIdx = 1;
          const pvqQ = getPvqQuestion(pIdx);
          const pvqStimulus = pvqQ.text;

          await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${pvqStimulus}`);

          const pvqSys = buildSystemPrompt({ phase: "pvq_40", stimulus: pvqStimulus });
          const nextHistory = await getShortHistoryBounded(supabase, userId);
          const nextMessages: Msg[] = [
            { role: "system", content: pvqSys },
            ...nextHistory,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("📤 GPT → PVQ-40 Q", pIdx);
          const pvqStart = await callOpenAI(nextMessages, undefined, 0.2, 320);
          const pvqStartClean = stripTechnicalBlocks(pvqStart);
          if (pvqStartClean) await storeInShort(supabase, userId, "assistant", pvqStartClean);
          return NextResponse.json({ message: pvqStartClean || pvqStart });
        }

        // Sinon, préparer Qn+1 (ECR-R)
        const nextIndex = targetIndex + 1;
        const nextMeta = getEcrRQuestion(nextIndex);
        const nextStimulus = nextMeta.text;
        console.log(`➡️ Préparation stimulus ECR-R q${nextIndex}`);
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulus}`);

        const nextSys = buildSystemPrompt({ phase: "ecr_r", stimulus: nextStimulus });
        const nextHistory = await getShortHistoryBounded(supabase, userId);
        const nextMessages: Msg[] = [
          { role: "system", content: nextSys },
          ...nextHistory,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("📤 GPT → ECR-R Q", nextIndex);
        const nextQ = await callOpenAI(nextMessages, undefined, 0.2, 320);
        const nextQClean = stripTechnicalBlocks(nextQ);
        if (nextQClean) await storeInShort(supabase, userId, "assistant", nextQClean);
        return NextResponse.json({ message: nextQClean || nextQ });
      }

      if (resolved.phase === "pvq_40") {
        // ===== PVQ-40 branch =====
        console.log("🧭 Stimulus en cours → phase 'pvq_40'");
        const sys = buildSystemPrompt({ phase: "pvq_40", stimulus: pendingStimulus });
        const history = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: sys },
          ...history,
          { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
        ];

        const assistant = await callOpenAI(messages, undefined, 0.2, 320);
        console.log("💬 PVQ assistant:", assistant);
        const score = extractScore(assistant);
        const visibleAssistant = stripTechnicalBlocks(assistant);
        if (visibleAssistant) await storeInShort(supabase, userId, "assistant", visibleAssistant);

        if (score == null) {
          console.log("ℹ️ Pas de SCORE détecté (PVQ) → on renvoie la réponse telle quelle");
          return NextResponse.json({ message: visibleAssistant || assistant });
        }

        console.log("🧠 SCORE détecté (PVQ-40):", score);

        const pvqRow = (await getPvqRow(supabase, userId)) as PvqRow | null;
        if (!pvqRow) {
          console.error("❌ pvq_40 row introuvable pour user:", userId);
          return NextResponse.json({ error: "pvq_40 missing" }, { status: 500 });
        }

        const targetIndex = resolved.index ?? findCurrentIndexPvq(pvqRow);
        const qMeta = getPvqQuestion(targetIndex);
        const col = qMeta.key as keyof PvqRow;

        // clamp + reverse (1..6) — NB: PVQ peut être non inversé, on respecte isReversed
        const s = clamp(score, 1, SCALE_MAX.pvq_40);
        const finalScore = qMeta.isReversed ? reverse(s, SCALE_MAX.pvq_40) : s;

        if (pvqRow[col] != null) {
          console.warn(`⚠️ ${String(col)} already set — skipping overwrite (PVQ-40)`);
        } else {
          console.log(`📝 (PVQ-40) Écriture ${String(col)} = ${finalScore} (isReversed=${qMeta.isReversed})`);
          const { error: upErr } = await supabase
            .from("pvq_40")
            .update({ [col]: finalScore })
            .eq("user_id", userId);
          if (upErr) {
            console.error("❌ Update error PVQ-40:", upErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }
        }

        // Fin de test PVQ-40 ?
        if (targetIndex === 40) {
          console.log("🏁 PVQ-40 Q40 atteinte → is_complete = true (PVQ-40)");
          const { error: finErr } = await supabase
            .from("pvq_40")
            .update({ is_complete: true })
            .eq("user_id", userId);
          if (finErr) {
            console.error("❌ Flag complete error (PVQ-40):", finErr);
            return NextResponse.json({ error: "DB update error" }, { status: 500 });
          }
          const doneMsg = "✅ PVQ-40 terminé. Merci pour ta participation.";
          await storeInShort(supabase, userId, "assistant", doneMsg);
          return NextResponse.json({ message: doneMsg });
        }

        // Sinon, préparer Qn+1 (PVQ-40)
        const nextIndex = targetIndex + 1;
        const nextMeta = getPvqQuestion(nextIndex);
        const nextStimulus = nextMeta.text;
        console.log(`➡️ Préparation stimulus PVQ-40 q${nextIndex}`);
        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${nextStimulus}`);

        const nextSys = buildSystemPrompt({ phase: "pvq_40", stimulus: nextStimulus });
        const nextHistory = await getShortHistoryBounded(supabase, userId);
        const nextMessages: Msg[] = [
          { role: "system", content: nextSys },
          ...nextHistory,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("📤 GPT → PVQ-40 Q", nextIndex);
        const nextQ = await callOpenAI(nextMessages, undefined, 0.2, 320);
        const nextQClean = stripTechnicalBlocks(nextQ);
        if (nextQClean) await storeInShort(supabase, userId, "assistant", nextQClean);
        return NextResponse.json({ message: nextQClean || nextQ });
      }
    }

    // ---- Si aucun stimulus en attente (fallback orchestré) ----
    if (bigFiveComplete) {
      await ensureIRIRow(supabase, userId);
      const iriRow = (await getIRIRow(supabase, userId)) as IRIRow | null;

      if (iriRow && iriRow.is_complete === true) {
        // IRI terminé → vérifier ECR-R
        await ensureECRRRow(supabase, userId);
        const ecrRow = await getECRRRow(supabase, userId);

        if (ecrRow && ecrRow.is_complete === true) {
          // ECR-R terminé → vérifier PVQ-40
          await ensurePvqRow(supabase, userId);
          const pvqRow = await getPvqRow(supabase, userId);

          if (pvqRow && pvqRow.is_complete === true) {
            console.log("👋 Phase 'complete' (tous tests terminés)");
            const sys = buildSystemPrompt({ phase: "complete" });
            const history = await getShortHistoryBounded(supabase, userId);
            const messages: Msg[] = [
              { role: "system", content: sys },
              ...history,
              { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
            ];
            const reply = await callOpenAI(messages, undefined, 0.2, 280);
            const cleaned = stripTechnicalBlocks(reply);
            await storeInShort(supabase, userId, "assistant", cleaned || reply);
            return NextResponse.json({ message: cleaned || reply });
          }

          // Démarrer PVQ-40 si pas encore complet
          let idx = 1;
          const row = pvqRow ?? ({} as PvqRow);
          idx = findCurrentIndexPvq(row);
          if (idx > 40) idx = 1;
          const pvqQ = getPvqQuestion(idx);
          const pvqStimulus = pvqQ.text;

          await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${pvqStimulus}`);

          const pvqSys = buildSystemPrompt({ phase: "pvq_40", stimulus: pvqStimulus });
          const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
          const messages: Msg[] = [
            { role: "system", content: pvqSys },
            ...historyAll,
            { role: "user", content: "[AUTO_CONTINUE]" },
          ];
          console.log("🤖 GPT start PVQ-40 Q", idx);
          const firstPvqQ = await callOpenAI(messages, undefined, 0.2, 320);
          const firstPvqQClean = stripTechnicalBlocks(firstPvqQ);
          await storeInShort(supabase, userId, "assistant", firstPvqQClean || firstPvqQ);
          return NextResponse.json({ message: firstPvqQClean || firstPvqQ });
        }

        // Démarrer ECR-R si pas encore complet
        let idx = 1;
        const row = ecrRow ?? ({} as EcrRRow);
        idx = findCurrentIndexECRR(row);
        if (idx > 36) idx = 1;
        const ecrQ = getEcrRQuestion(idx);
        const ecrStimulus = ecrQ.text;

        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${ecrStimulus}`);

        const ecrSys = buildSystemPrompt({ phase: "ecr_r", stimulus: ecrStimulus });
        const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: ecrSys },
          ...historyAll,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🤖 GPT start ECR-R Q", idx);
        const firstEcrQ = await callOpenAI(messages, undefined, 0.2, 320);
        const firstEcrQClean = stripTechnicalBlocks(firstEcrQ);
        await storeInShort(supabase, userId, "assistant", firstEcrQClean || firstEcrQ);
        return NextResponse.json({ message: firstEcrQClean || firstEcrQ });
      }

      // IRI non terminé → démarrer IRI si besoin
      if (!iriRow || iriRow.is_complete !== true) {
        let idx = 1;
        const row = iriRow ?? ({} as IRIRow);
        idx = findCurrentIndexIRI(row);
        if (idx > 28) idx = 1;
        const iriQ = getIRIQuestion(idx);
        const iriStimulus = iriQ.text;

        await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${iriStimulus}`);

        const iriSys = buildSystemPrompt({ phase: "iri", stimulus: iriStimulus });
        const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
        const messages: Msg[] = [
          { role: "system", content: iriSys },
          ...historyAll,
          { role: "user", content: "[AUTO_CONTINUE]" },
        ];
        console.log("🤖 GPT start IRI Q", idx);
        const firstIriQ = await callOpenAI(messages, undefined, 0.2, 320);
        const firstIriQClean = stripTechnicalBlocks(firstIriQ);
        await storeInShort(supabase, userId, "assistant", firstIriQClean || firstIriQ);
        return NextResponse.json({ message: firstIriQClean || firstIriQ });
      }
    }

    // ---- Phase INTRO par défaut (si rien d'autre ne matche) ----
    console.log("👋 Phase 'intro' (fallback)");
    const sys = buildSystemPrompt({ phase: "intro" });
    const history = await getShortHistoryBounded(supabase, userId);
    const messages: Msg[] = [
      { role: "system", content: sys },
      ...history,
      { role: "user", content: composedUserInput || "[AUTO_CONTINUE]" },
    ];
    const reply = await callOpenAI(messages, undefined, 0.2, 280);

    if (hasTriggerOrchestrator(reply)) {
      const enthusiasm = stripTechnicalBlocks(reply);
      if (enthusiasm) await storeInShort(supabase, userId, "assistant", enthusiasm);

      const bfRow = await getBigFiveRow(supabase, userId);
      let step = findCurrentIndexBigFive(bfRow);
      if (step > 18) step = 1;

      const q = getBigFiveQuestion(step);
      const stimulus = q.text;
      console.log(`📌 Stimulus q${step}:`, stimulus);
      await storeInShort(supabase, userId, "assistant", `[STIMULUS]\n${stimulus}`);

      const qSys = buildSystemPrompt({ phase: "big_five", stimulus });
      const historyAll: Msg[] = await getShortHistoryBounded(supabase, userId);
      const qMessages: Msg[] = [{ role: "system", content: qSys }, ...historyAll];

      console.log("🤖 GPT start Q", step);
      const firstQ = await callOpenAI(qMessages, undefined, 0.2, 320);
      const firstQClean = stripTechnicalBlocks(firstQ);
      await storeInShort(supabase, userId, "assistant", firstQClean || firstQ);

      const out = (enthusiasm ? enthusiasm + "\n\n" : "") + (firstQClean || firstQ);
      return NextResponse.json({ message: out });
    }

    const cleaned = stripTechnicalBlocks(reply);
    await storeInShort(supabase, userId, "assistant", cleaned || reply);
    return NextResponse.json({ message: cleaned || reply });
  } catch (err: unknown) {
    const e = err as {
      response?: { data?: { error?: { message?: string } }; status?: number };
      message?: string;
      status?: number;
    };
    console.error("❌ Error in ask route:", e);
    const msg =
      e?.response?.data?.error?.message ||
      e?.message ||
      "Server error";
    const status = Number(e?.status) || Number(e?.response?.status) || 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
