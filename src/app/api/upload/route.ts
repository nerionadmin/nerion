import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,         // depuis .env.local
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service_role (secret)
);

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userId = (formData.get("userId") as string) || "unknown_user";

    if (!file) {
      return NextResponse.json({ error: "File missing" }, { status: 400 });
    }

    const ext = (file.name?.split(".").pop() || "jpg").toLowerCase();
    const filePath = `${userId}/${Date.now()}.${ext}`;

    // ⚠️ mets ici exactement le nom de TON bucket
    const BUCKET = "media"; // change en "Media" si ton bucket a une majuscule

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, file, { contentType: file.type || "application/octet-stream", upsert: false });

    if (uploadError) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }

    // Enregistrer le média en base (table public.media)
    await supabase
      .from("media")
      .insert({
        user_id: userId,
        url: filePath,     // on stocke le path permanent (pas l'URL signée)
        type: "image",
        context: "profil",
        private: true
      });

    // bucket privé → URL signée 1h
    const { data: signed, error: signError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(filePath, 60 * 60);

    if (signError || !signed) {
      // on renvoie au moins le chemin si la signature échoue
      return NextResponse.json({ path: filePath }, { status: 200 });
    }

    return NextResponse.json({ url: signed.signedUrl, path: filePath });
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
