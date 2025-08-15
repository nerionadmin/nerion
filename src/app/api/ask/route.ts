export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

type MessageRecord = {
  role: "system" | "user" | "assistant";
  content: string;
};

type MemoryItem = {
  kind?: string;
  content: string;
  importance?: number;
};

export async function POST(req: Request) {
  try {
    const { userId, message }: { userId?: string; message?: string } =
      await req.json();

    if (!userId || !message) {
      return NextResponse.json(
        { error: "userId and message required" },
        { status: 400 }
      );
    }

    const db = supabaseServer();

    // 1) Stocker le message utilisateur
    await db.from("messages").insert({
      user_id: userId,
      role: "user",
      content: message,
    });

    // 2) Récupérer l’historique récent
    const { data: recent } = await db
      .from("messages")
      .select("role, content")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(12);

    const history: MessageRecord[] = Array.isArray(recent)
      ? (recent as MessageRecord[])
      : [];

    // 3) Demander une réponse à l’IA
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu es une IA attentive et aidante." },
        ...history.map((m: MessageRecord) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: message },
      ],
      temperature: 0.7,
    });

    const reply = chat.choices[0]?.message?.content?.trim() || "…";

    // 4) Extraire des souvenirs -> insérer dans `memories`
    const extraction = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Analyse ce message et retourne un JSON compact {items: [{kind, content, importance}]} avec les faits importants, préférences, valeurs ou objectifs. Réponds uniquement en JSON.",
        },
        { role: "user", content: message },
      ],
      temperature: 0,
      response_format: { type: "json_object" as const },
    });

    let items: MemoryItem[] = [];
    try {
      const parsed = JSON.parse(
        extraction.choices[0].message?.content || "{}"
      );
      items = Array.isArray(parsed.items) ? (parsed.items as MemoryItem[]) : [];
    } catch {
      // parsing échoué, on laisse items vide
    }

    if (items.length > 0) {
      await db.from("memories").insert(
        items.map((it: MemoryItem) => ({
          userid: userId,
          content: it.content,
          type: it.kind || "text",
        }))
      );
    } else {
      await db.from("memories").insert({
        userid: userId,
        content: message,
        type: "text",
      });
    }

    // 5) Sauvegarder la réponse
    await db.from("messages").insert({
      user_id: userId,
      role: "assistant",
      content: reply,
    });

    return NextResponse.json({ reply, saved_memories: items.length || 1 });
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    console.error("Unknown error", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
