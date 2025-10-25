// lib/memory.ts — mémoire short uniquement, GPT lit du plus récent au plus ancien

import type { SupabaseClient } from "@supabase/supabase-js";

export type MemoryRole = "user" | "assistant";

/**
 * Stocke un message en mémoire courte (short).
 */
export async function storeInShort(
  supabase: SupabaseClient,
  userId: string,
  role: MemoryRole,
  content: string
) {
  const { error } = await supabase.from("memories").insert({
    user_id: userId,
    role,
    content,
    layer: "short",
  });

  if (error) {
    console.error("❌ Échec insertion memory short", error);
    throw error;
  }
}

/**
 * Récupère les messages short depuis Supabase,
 * dans l’ordre du plus récent au plus ancien (comme demandé).
 */
export async function getRecentShortMemories(
  supabase: SupabaseClient,
  userId: string
) {
  const { data, error } = await supabase
    .from("memories")
    .select("role, content, created_at")
    .eq("user_id", userId)
    .eq("layer", "short")
    .order("created_at", { ascending: false }); // ✅ GPT lit d’abord les plus récents

  if (error) {
    console.error("❌ Erreur lecture memory short", error);
    return [];
  }

  return (data ?? []).map(({ role, content }) => ({ role, content }));
}