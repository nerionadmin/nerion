// src/app/api/voice/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs"; // requis pour Buffer & stream

export async function POST(req: Request) {
  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Texte manquant" }, { status: 400 });
    }

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY!}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1-hd",              // ✅ Qualité maximale
        voice: "nova",               // 🔊 Voix féminine fluide (voir alternatives ci-dessous)
        input: text,
        response_format: "mp3",         // 🎧 Format audio
        speed: 1.2,                     // 🕐 Vitesse normale
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("❌ Erreur TTS OpenAI :", err);
      return NextResponse.json({ error: "Erreur synthèse vocale" }, { status: 500 });
    }

    const audioBuffer = await response.arrayBuffer();

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("❌ Erreur serveur synthèse vocale :", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
