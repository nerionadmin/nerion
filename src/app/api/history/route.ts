/* eslint-disable no-console */
// app/api/history/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";

export async function GET() {
  // ✅ Next.js 15 : cookies() est async
  const cookieStore = await cookies();

  // ⚠️ Patch de typage (Next 15 vs auth-helpers) pour enlever le rouge dans l’éditeur
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error Type mismatch between Next 15 cookies() and auth-helpers; safe at runtime
  const supabase = createRouteHandlerClient({ cookies: () => cookieStore });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    console.error("getUser error:", error);
    return NextResponse.json({ error: "Auth error" }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  // 🔥 Requête sur la table messages
  const { data, error: dbError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (dbError) {
    console.error("DB error:", dbError);
    return NextResponse.json({ error: dbError.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] }, { status: 200 });
}
