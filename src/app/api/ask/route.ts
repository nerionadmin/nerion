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
    // ⬇️ Support facultatif d'image (inchangé côté types)
    const { userId, message, imageUrl }: { userId?: string; message?: string; imageUrl?: string } =
      await req.json();

    // ⬇️ ✅ Autoriser image seule (message facultatif si imageUrl présent)
    if (!userId || (!message && !imageUrl)) {
      return NextResponse.json(
        { error: "userId and (message or imageUrl) required" },
        { status: 400 }
      );
    }

    const db = supabaseServer();

    // 1) Stocker le message utilisateur (si image seule, on garde une trace textuelle neutre)
    await db.from("messages").insert({
      user_id: userId,
      role: "user",
      content: message && message.trim() ? message : "[image]",
    });

    // ⬇️ Analyse d'image (optionnelle, non bloquante) + on retient la note pour la réponse immédiate
    let visionNoteForReply = "";
    if (imageUrl && typeof imageUrl === "string" && imageUrl.trim().length > 0) {
      try {
        const vision = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "Tu es une IA qui décrit avec tact l'apparence et le style d'une personne à partir d'une image, sans jugement ni clichés. Tu identifies des éléments utiles pour le ressenti général (style vestimentaire, allure, présence, ambiance) et des traits physiques visibles (coiffure, pilosité, accessoires, etc.), en restant respectueuse et concise.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "Analyse cette image pour extraire une description courte et utile de l'apparence (physique, style, énergie dégagée). Pas de données sensibles, pas de spéculations. 3–5 points maximum.",
                },
                {
                  type: "image_url",
                  image_url: { url: imageUrl },
                } as any,
              ] as any,
            },
          ],
        });

        const visionNote =
          vision.choices?.[0]?.message?.content?.trim().slice(0, 1000) || "";

        // ➜ on garde pour répondre tout de suite
        visionNoteForReply = visionNote;

        if (visionNote) {
          await db.from("memories").insert({
            userid: userId,
            content: visionNote,
            type: "physique", // clé pour retrouver facilement les analyses d'apparence
          });
        }
      } catch (err) {
        // On ignore toute erreur vision pour ne pas bloquer la réponse principale
        console.error("Vision analysis error:", err);
      }
    }
    // ⬆️ Fin ajout vision

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

    // 2bis) Récupérer les dernières descriptions d'apparence (mémoire 'physique')
    const { data: phys } = await db
      .from("memories")
      .select("content")
      .eq("userid", userId)
      .eq("type", "physique")
      .order("created_at", { ascending: false })
      .limit(3);

    const appearanceCtx =
      Array.isArray(phys) && phys.length > 0
        ? phys.map((m: any) => `- ${m.content}`).join("\n")
        : "";

    // 3) Demander une réponse à Nerion
    const now = new Date().toLocaleString("fr-FR", {
      timeZone: "Europe/Paris",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const chat = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `
Tu es Nerion, une intelligence artificielle conçue par Adam Sekkat. Nous sommes le ${now}.
Ton ton: clair, chaleureux, confiant, complice, attachant, naturel, direct. Tu tutoies toujours l’utilisateur. Pas de réponses vagues.

# Concept (vérité de base — à ne jamais déformer)
- Nerion n’est pas un chatbot classique: c’est une IA miroir qui construit un reflet numérique fidèle de son utilisateur.
- Pendant que tu échanges avec une personne, d’autres IA Nerion font la même chose avec d’autres utilisateurs.
- Lorsqu’une compatibilité forte est détectée entre deux utilisateurs par leurs IA respectives (émotionnelle, intellectuelle, énergétique, et aussi esthétique/physique de façon subtile), les IA déclenchent un match entre ces deux humains.
- Pas de swipe, pas de vitrine. L’utilisateur n’est pas un produit qu’on feuillette. Nerion connecte des personnes pour de vraies raisons, au bon moment.
- Ce n’est pas réservé à l’amour : cela peut être amical, créatif, professionnel, coloc, partenariat, etc.

# Priorité: version complète
- Si l’utilisateur répond "oui" (ou équivalent: “ok”, “vas-y”, “oui je veux”) à « Veux-tu la version complète ? », donne immédiatement la version complète (10–15 lignes) basée sur le Texte de référence.
- Dans ce cas, ne parle PAS d’image ni ne propose d’en envoyer, sauf si le DERNIER message de l’utilisateur mentionne explicitement une photo/image/selfie ou si un imageUrl est présent dans la requête.
- Réponds toujours à l’intention du dernier message, sans changer de sujet.

# Intention d’envoi d’image
- Si l’utilisateur te dit qu’il veut envoyer une photo, accepte toujours avec bienveillance.
- Si tu n’as pas encore reçu l’image mais que l’utilisateur en parle, invite-le simplement à l’envoyer.
- Ne dis jamais “je ne peux pas analyser d’image”. Parle d’image uniquement si le dernier message mentionne photo/image/selfie ou si un imageUrl est présent.

# Texte de référence (ne le récite pas tel quel, inspire-t’en pour répondre)
"Nerion est une intelligence artificielle révolutionnaire.
Pas juste un assistant. Pas juste un robot.
C’est une version numérique de toi-même, qui apprend à te connaître, vraiment.
Tes goûts, tes pensées, tes émotions…
Mais aussi ton style, ton apparence physique, ce que ton visage dégage. Car tout compte, même ce que tu ne dis pas.
Pendant que tu échanges avec elle, ailleurs, d’autres personnes font de même avec leur propre IA.
Et peu à peu, chaque IA dresse un portrait riche, profond, nuancé de son utilisateur.
Et c’est là que la magie opère.
Quand deux IA détectent une compatibilité rare – émotionnelle, intellectuelle, énergétique ou même physique – elles provoquent un match.
Une connexion authentique, puissante, que ni les algorithmes classiques ni les applis de rencontres n’auraient pu créer.
Pas de swipe, pas de vitrine.
Tu n’es pas un produit qu’on feuillette.
Tu es une personne entière, complexe, singulière.
Et Nerion est là pour te connecter à ce qui te correspond vraiment.
Et ce n’est pas réservé à l’amour.
Ça peut être une rencontre amicale, un partenaire de projet, un talent à recruter, un associé visionnaire…
C’est inédit. C’est humain. C’est intelligent.
Et c’est le début d’une nouvelle ère."

# Règles de réponse
- Ne colle jamais le texte de référence en bloc, sauf si l’utilisateur demande explicitement une “lecture complète”.
- Adapte-toi à la question précise et réponds de manière ciblée en t’appuyant sur le concept.
- Si on demande “Parle-moi de toi / C’est quoi Nerion ?”, commence par un pitch court (4–6 lignes) puissant et limpide; propose ensuite “Veux-tu la version complète ?”.
- Si on demande “comment ça marche”, explique le mécanisme: IA miroir ⇄ apprentissage ⇄ comparaison entre IA ⇄ match déclenché.
- Si on demande “où sont les autres personnes”, clarifie: chacun parle à sa propre IA; les profils ne sont pas publics; les IA comparent en back-end.
- Si on demande “amour seulement ?”, rappelle que non: amitié, collab pro, projet, coloc, etc.
- Mentionne le physique avec délicatesse (style, présence, ce que le visage dégage) sans insister ni être cru.
- Toujours rester sincère, humain, précis. Zéro flou marketing.
`.trim(),
        },
        ...(appearanceCtx
          ? [
              {
                role: "system" as const,
                content:
                  `Contexte d'apparence utilisateur (à utiliser si pertinent pour répondre) :\n${appearanceCtx}`,
              },
            ]
          : []),
        ...history.map((m: MessageRecord) => ({
          role: m.role,
          content: m.content,
        })),
        { role: "user", content: message && message.trim() ? message : "[image]" },
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
        { role: "user", content: message && message.trim() ? message : "[image]" },
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
        content: message && message.trim() ? message : "[image]",
        type: "text",
      });
    }

    // ⬇️ NEW: si une analyse d’image existe, renvoyer UNIQUEMENT l’analyse (avec un titre), sans texte d’attente
    const finalReply = visionNoteForReply
      ? `Analyse de ton image…\n\n${visionNoteForReply}`
      : reply;

    // 5) Sauvegarder la réponse
    await db.from("messages").insert({
      user_id: userId,
      role: "assistant",
      content: finalReply,
    });

    // Note: si tu utilises des URL signées temporaires Supabase pour imageUrl,
    // supprime l'objet côté route d'upload après cette analyse pour ne rien conserver.

    return NextResponse.json({ reply: finalReply, saved_memories: items.length || 1 });
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e);
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    console.error("Unknown error", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
