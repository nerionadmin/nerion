export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabaseServer } from "@/lib/supabase";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    const { userId, message } = await req.json();
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

    const history = (recent || []).reverse();

    // 3) Demander une réponse à l’IA
    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Tu es une IA attentive et aidante." },
        ...history.map((m: any) => ({ role: m.role, content: m.content })),
        { role: "user", content: message },
      ],
      temperature: 0.7,
    });

    const reply = chat.choices[0]?.message?.content?.trim() || "…";

    // 4) Extraire des souvenirs -> insérer dans `memories` (userid, content, type)
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

    let items: Array<{ kind?: string; content: string; importance?: number }> =
      [];
    try {
      const parsed = JSON.parse(extraction.choices[0].message?.content || "{}");
      items = parsed.items || [];
    } catch {
      // si le parsing échoue, on laissera "items" vide et on insèrera le message brut
    }

    if (items.length > 0) {
      await db.from("memories").insert(
        items.map((it) => ({
          userid: userId,                 // ⚠️ ta colonne s'appelle bien "userid"
          content: it.content,            // texte du souvenir
          type: it.kind || "text",        // ex: 'fact', 'preference'… sinon 'text'
        }))
      );
    } else {
      // fallback : on mémorise au moins le message en clair
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
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}
