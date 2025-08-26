// src/app/api/ask/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { buildSystemPrompt } from "../../../lib/prompts/system";
import { getRelevantMemories, storeInShort } from "../../../lib/memory";
import { NAP_PROMPT } from "../../../lib/prompts/psychometry";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: Request) {
  try {
    // 0) Auth header
    const authHeader =
      req.headers.get("authorization") || req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ error: "Unauthorized: no token" }, { status: 401 });
    }

    // 1) Supabase client (service role)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 2) Validate user from token
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user?.id) {
      return NextResponse.json({ error: "Unauthorized: invalid token" }, { status: 401 });
    }

    const userId = data.user.id;

    // 3) Parse body
    const body = await req.json();
    const userMessage: string | undefined = body.message?.trim();

    if (!userMessage) {
      return NextResponse.json({ error: "No user message provided" }, { status: 400 });
    }

    // 4) Memory context (short → persistent → archive)
    const relevantMemories = await getRelevantMemories(userId, userMessage);

    type MemoryMessage = { role: "user" | "assistant"; content: string };
    const historyMessages: MemoryMessage[] = (relevantMemories || []).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.content,
    }));

    // 5) Build messages (no temporal logic)
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: buildSystemPrompt(req.headers) },
      { role: "system", content: NAP_PROMPT }, // Activate Nerion AI Psychometry Protocol
      ...historyMessages,
      { role: "user", content: userMessage },
    ];

    // 6) OpenAI call
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages,
      temperature: 0.7,
    });

    const assistantMessage = completion.choices?.[0]?.message?.content?.trim();

    // Debug (remove in prod if desired)
    console.log("🧠 OpenAI response:", completion);
    console.log("💬 Assistant message:", assistantMessage);

    if (!assistantMessage) {
      return NextResponse.json({ error: "Invalid response from OpenAI" }, { status: 500 });
    }

    // 7) Store in short-term memory (triggers handle rollover)
    await storeInShort(userId, "user", userMessage);
    await storeInShort(userId, "assistant", assistantMessage);

    // 8) Return
    return NextResponse.json({ message: assistantMessage });
  } catch (e) {
    console.error("Error in ask route:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
