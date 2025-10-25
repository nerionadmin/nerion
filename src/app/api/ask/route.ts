/* eslint-disable @typescript-eslint/no-explicit-any */
// src/app/api/ask/route.ts
// GET: heure serveur via RPC (+ ?fn=me pour infos profil minimal: full_name + initials + strictness_level)
// PATCH: mises à jour users / user_profiles (inclut strictness_level 1..3)
// (⚠️ Plus de gestion d'upload ici : les étapes 7/8/9 uploadent depuis le frontend vers Supabase)

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Helper: extrait le Bearer token (sans validation) */
function getBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization");
  return h && h.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Helper: client Supabase « user-bound » (ANON + JWT user) pour RPC avec auth.uid() */
function createUserClientWithToken(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, // important: ANON ici, pas service key
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    }
  );
}

/**
 * Auth helper (Bearer token requis)
 * - Valide le token utilisateur auprès de Supabase
 * - Retourne { supabase, userId } si OK, sinon lève une erreur contrôlée
 */
async function authenticateOrThrow(req: Request) {
  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  if (!token) {
    throw { status: 401, message: "Unauthorized: no token" };
  }

  // Service key côté serveur (OK dans un route handler Next.js côté server)
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    throw { status: 401, message: "Unauthorized: invalid token" };
  }

  return { supabase, userId: authData.user.id };
}

/** Helper: calcule des initiales lisibles à partir d’un full_name */
function initialsFromFullName(nameRaw: string | null | undefined): string {
  const name = (nameRaw || "").trim();
  if (!name) return "";

  // Découpe par espaces
  const parts = name.split(/\s+/).filter(Boolean);
  const upper = (s: string) => s.toLocaleUpperCase();

  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return upper(`${first}${last}`);
  }

  // Un seul mot → on tente de splitter par "-" ou "_"
  const solo = parts[0];
  const hy = solo.split(/[-_]/).filter(Boolean);
  if (hy.length >= 2) {
    return upper(`${hy[0][0] ?? ""}${hy[1][0] ?? ""}`);
  }

  return upper(solo.slice(0, 1));
}

/* ===========================================================
 * GET /api/ask
 * - ?fn=me → renvoie { full_name, initials, strictness_level }
 * - sinon → renvoie l'heure serveur (UTC) via RPC (comportement existant)
 * ===========================================================
 */
export async function GET(req: Request) {
  try {
    const { supabase, userId } = await authenticateOrThrow(req);
    const url = new URL(req.url);
    const fn = url.searchParams.get("fn");

    // ——— Nouvelle branche : GET /api/ask?fn=incoming_match (enriched + status)
    if (fn === "incoming_match") {
      const { data, error } = await supabase
        .from("matches")
        .select("id, status, match_gender, match_age, distance_km, score_pref_to_self")
        .eq("user_id", userId)
        .neq("status", "deleted")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("❌ incoming_match failed:", error?.message);
      }

      return NextResponse.json({
        hasIncomingMatch: !!data,
        match_id: data?.id ?? null,
        status: data?.status ?? null,               // ⬅️ now included
        match_gender: data?.match_gender ?? null,
        match_age: data?.match_age ?? null,
        distance_km: data?.distance_km ?? null,
        score_pref_to_self: data?.score_pref_to_self ?? null,
      });
    }

    // ——— Nouvelle branche : GET /api/ask?fn=match_photos&id=<otherId>
    // Retourne les 6 photos confirmées du match (bucket photos_user) après double vérif miroir
    if (fn === "match_photos") {
      const otherId = url.searchParams.get("id");
      if (!otherId) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
      }

      try {
        // ✅ Authentifie et récupère userId courant
        const { supabase, userId } = await authenticateOrThrow(req);

        // 1️⃣ Vérifie la relation miroir stricte A↔B
        const { data: rows, error: mirrorErr } = await supabase
          .from("matches")
          .select("user_id, match_user_id, status")
          .or(
            `and(user_id.eq.${userId},match_user_id.eq.${otherId}),` +
            `and(user_id.eq.${otherId},match_user_id.eq.${userId})`
          );

        if (mirrorErr) {
          console.error("❌ match_photos mirror check failed:", mirrorErr?.message);
          return NextResponse.json({ error: "Mirror check failed" }, { status: 500 });
        }

        const mine  = rows?.find(r => r.user_id === userId && r.match_user_id === otherId);
        const other = rows?.find(r => r.user_id === otherId && r.match_user_id === userId);

        // ❌ Si la relation n’est pas réciproque OU pas confirmée → refus
        if (!mine || !other || mine.status !== "confirmed" || other.status !== "confirmed") {
          return NextResponse.json({ error: "Mirror not confirmed" }, { status: 403 });
        }

        // 2️⃣ Récupère les 6 photos "self" confirmées de l’autre utilisateur
        const { data: pics, error: picsErr } = await supabase
          .from("photos")
          .select("path")
          .eq("user_id", otherId)
          .eq("photo", "self")
          .eq("status", "confirmed")
          .order("id", { ascending: true })
          .limit(6);

        if (picsErr) {
          console.error("❌ match_photos select failed:", picsErr?.message);
          return NextResponse.json({ error: "Failed to fetch photos" }, { status: 500 });
        }

        // 3️⃣ Crée les URLs signées depuis le bucket 'photos_user'
        const signed = await Promise.all(
          (pics ?? []).map(async (row: any) => {
            const { data: s } = await supabase.storage
              .from("photos_user")
              .createSignedUrl(row.path, 3600);
            return s?.signedUrl || "";
          })
        );

        // 4️⃣ Renvoie le tableau de photos
        return NextResponse.json({
          photos: signed.filter(Boolean),
        });
      } catch (err) {
        console.error("💥 match_photos unexpected error:", err);
        return NextResponse.json({ error: "Server error (match_photos)" }, { status: 500 });
      }
    }

    // ——— NOUVELLE BRANCHE: GET /api/ask?fn=chat_list&match_id=<uuid>[&limit=50][&before=ISO]
    // Appelle la RPC SQL `chat_list` avec le JWT utilisateur (auth.uid()) → vérifie A↔B confirmés
    if (fn === "chat_list") {
      const matchId = url.searchParams.get("match_id");
      if (!matchId) {
        return NextResponse.json({ error: "Missing match_id" }, { status: 400 });
      }

      const limitParam = url.searchParams.get("limit");
      const before = url.searchParams.get("before");
      const limitRaw = limitParam ? parseInt(limitParam, 10) : 50;
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

      let p_before: string | null = null;
      if (before) {
        const d = new Date(before);
        if (!isNaN(d.getTime())) p_before = d.toISOString();
      }

      const token = getBearerToken(req);
      if (!token) {
        return NextResponse.json({ error: "Unauthorized: no token" }, { status: 401 });
      }
      const userClient = createUserClientWithToken(token);

      const { data, error } = await userClient.rpc("chat_list", {
        p_match_id: matchId,
        p_limit: limit,
        p_before: p_before ?? null,
      });

      if (error) {
        console.error("❌ chat_list RPC failed:", error);
        return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
      }

      const messages = (data ?? []).map((m: any) => ({
        id: m.id,
        user_a: m.user_a,
        user_b: m.user_b,
        sender_id: m.sender_id,
        body: m.body,
        attachments: m.attachments ?? [],
        created_at: m.created_at,
        edited_at: m.edited_at ?? null,
        deleted_at: m.deleted_at ?? null,
      }));

      return NextResponse.json({ messages });
    }

    // ——— NOUVELLE BRANCHE: GET /api/ask?fn=user_name&id=<otherId>
    // Vérifie STRICTEMENT la relation miroir (A→B et B→A) avant de retourner users.full_name
    if (fn === "user_name") {
      const otherId = url.searchParams.get("id");
      if (!otherId) {
        return NextResponse.json({ error: "Missing id" }, { status: 400 });
      }

      // Vérification miroir stricte (sans autre condition annexe)
      const { data: mirrorRows, error: mirrorErr } = await supabase
        .from("matches")
        .select("user_id, match_user_id")
        .or(
          `and(user_id.eq.${userId},match_user_id.eq.${otherId}),` +
          `and(user_id.eq.${otherId},match_user_id.eq.${userId})`
        );

      if (mirrorErr) {
        console.error("❌ user_name mirror check failed:", mirrorErr?.message);
        return NextResponse.json({ error: "Mirror check failed" }, { status: 500 });
      }

      const mine = mirrorRows?.find((r: any) => r.user_id === userId && r.match_user_id === otherId);
      const other = mirrorRows?.find((r: any) => r.user_id === otherId && r.match_user_id === userId);

      if (!mine || !other) {
        // Relation non réciproque → on ne retourne pas le nom
        return NextResponse.json({}, { status: 403 });
      }

      // OK miroir → on retourne le full_name depuis users
      const { data: userRow, error: userErr } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", otherId)
        .maybeSingle();

      if (userErr) {
        console.error("❌ user_name users.full_name failed:", userErr?.message);
        return NextResponse.json({ error: "Failed to fetch user_name" }, { status: 500 });
      }

      if (!userRow?.full_name) {
        return NextResponse.json({}, { status: 404 });
      }

      return NextResponse.json({ full_name: userRow.full_name });
    }

    // ——— Nouvelle branche: GET /api/ask?fn=me
    if (fn === "me") {
      // 1) Lecture users.full_name
      const { data: userRow, error: userErr } = await supabase
        .from("users")
        .select("full_name")
        .eq("id", userId)
        .maybeSingle();

      if (userErr) {
        console.error("❌ Query users.full_name failed:", userErr?.message);
        return NextResponse.json(
          { error: "Failed to fetch profile name" },
          { status: 500 }
        );
      }

      // 2) Lecture user_profiles.strictness_level
      let strictness: number | null = null;
      const { data: profileRow, error: profErr } = await supabase
        .from("user_profiles")
        .select("strictness_level, step_index")
        .eq("user_id", userId)
        .maybeSingle();

      if (profErr) {
        // Pas bloquant: on log seulement et on laisse strictness = null
        console.warn("⚠️ user_profiles.strictness_level fetch failed:", profErr.message);
      } else {
        const v = (profileRow?.strictness_level ?? null) as number | null;
        strictness = typeof v === "number" && Number.isFinite(v) ? v : null;
      }

      // step_index (optionnel)
      let step_index: number | null = null;
      try {
        const si = (profileRow?.step_index ?? null) as number | null;
        if (typeof si === "number" && Number.isFinite(si)) {
          const siInt = Math.trunc(si);
          step_index = siInt >= 1 && siInt <= 10 ? siInt : null;
        }
      } catch {}
      const full_name = (userRow?.full_name ?? "") as string;
      const initials = initialsFromFullName(full_name);

      // ➜ On renvoie strictness_level à la racine et dans profile pour compat front.
      return NextResponse.json({
        full_name: full_name || null,
        initials,
        strictness_level: strictness,
        profile: { strictness_level: strictness, step_index },
      });
    }

    // ——— Comportement GET existant (heure serveur)
    console.log("👤 [GET /api/ask] userId:", userId);

    // RPC côté Supabase : `select now()` (UTC)
    const { data, error } = await supabase.rpc("get_current_timestamp");
    if (error || !data) {
      console.error("❌ RPC get_current_timestamp failed:", error?.message);
      return NextResponse.json(
        { error: "RPC get_current_timestamp failed" },
        { status: 500 }
      );
    }

    const iso = typeof data === "string" ? data : new Date(data).toISOString();
    const year = new Date(iso).getUTCFullYear();

    return NextResponse.json({ nowIso: iso, year, source: "supabase" });
  } catch (err: any) {
    const status = err?.status || 500;
    const message = err?.message || "Server error";
    console.error("❌ [GET /api/ask] error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * PATCH /api/ask
 * - Reçoit différents champs et met à jour users / user_profiles.
 * - Ajout: validation stricte et upsert de { distance_max_km, latitude, longitude, accuracy }.
 * - NEW: prise en charge de user_profiles.relationship (enum relationship_type).
 * - NEW: prise en charge de user_profiles.strictness_level (int 1..3).
 */
export async function PATCH(req: Request) {
  try {
    const { supabase, userId } = await authenticateOrThrow(req);
    const body = await req.json();
    // === Branch: dismiss latest incoming match ===
    const fn = typeof body?.fn === 'string' ? body.fn : undefined;
    if (fn === 'dismiss_match') {
      try {
        // Optionnel: si tu fournis un match_id côté front, on l'utilise
        const matchId = body?.match_id as string | number | undefined;

        let targetId: string | number | null = null;

        if (matchId) {
          targetId = matchId;
        } else {
          // Sinon: on prend le DERNIER match de l'utilisateur (le plus récent)
          const { data: last, error: lastErr } = await supabase
            .from('matches')
            .select('id, status')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastErr) {
            console.error('❌ [dismiss_match] fetch latest failed:', lastErr?.message);
            return NextResponse.json({ error: 'Failed to fetch latest match' }, { status: 500 });
          }
          if (!last?.id) {
            return NextResponse.json({ error: 'No match to dismiss' }, { status: 404 });
          }

          targetId = last.id;
        }

        // ✅ Mise à jour de la ligne → status = 'deleted', match = false
        const { error: upErr } = await supabase
          .from('matches')
          .update({ status: 'deleted' })
          .eq('id', targetId as any)
          .eq('user_id', userId);

        if (upErr) {
          console.error('❌ [dismiss_match] update failed:', upErr?.message);
          return NextResponse.json({ error: 'Failed to dismiss match' }, { status: 500 });
        }

        return NextResponse.json({ success: true, fn: 'dismiss_match', match_id: targetId });
      } catch (e) {
        console.error('❌ [dismiss_match] unexpected error:', e);
        return NextResponse.json({ error: 'Server error (dismiss_match)' }, { status: 500 });
      }
    }
    // === Branch: confirm CURRENT match (multi-match sûr)
if (fn === 'confirm_match') {
  try {
    const matchId = body?.match_id as string | undefined;
    const matchUserId = body?.match_user_id as string | undefined;

    // 1) En multi-match, on EXIGE l'id du match courant
    if (!matchId) {
      return NextResponse.json({ error: 'Missing match_id' }, { status: 400 });
    }

    // 2) Vérifie que cette ligne t'appartient
    const { data: row, error: rowErr } = await supabase
      .from('matches')
      .select('id, user_id, match_user_id, status')
      .eq('id', matchId)
      .eq('user_id', userId)
      .maybeSingle();

    if (rowErr) {
      console.error('❌ [confirm_match] lookup failed:', rowErr?.message);
      return NextResponse.json({ error: 'Failed to fetch match' }, { status: 500 });
    }
    if (!row?.id) {
      return NextResponse.json({ error: 'Match not found for this user' }, { status: 404 });
    }

    // 3) (optionnel) recouper la paire A↔B si le front envoie match_user_id
    if (matchUserId && row.match_user_id && String(row.match_user_id) !== String(matchUserId)) {
      return NextResponse.json({ error: 'Pair mismatch (match_user_id)' }, { status: 409 });
    }

    // 4) Confirme TA ligne si pas déjà confirmé
    if (row.status !== 'confirmed') {
      const { error: upErr } = await supabase
        .from('matches')
        .update({ status: 'confirmed' })
        .eq('id', row.id)
        .eq('user_id', userId)
        .neq('status', 'deleted'); // sécurité: ne pas ressusciter un deleted

      if (upErr) {
        console.error('❌ [confirm_match] update failed:', upErr?.message);
        return NextResponse.json({ error: 'Failed to confirm match' }, { status: 500 });
      }
    }

    // 5) Ton TRIGGER SQL s'occupe du booléen `match` quand la ligne miroir est confirmée
    return NextResponse.json({ success: true, fn: 'confirm_match', match_id: row.id });
  } catch (e) {
    console.error('❌ [confirm_match] unexpected error:', e);
    return NextResponse.json({ error: 'Server error (confirm_match)' }, { status: 500 });
  }
}

    // === Branch: set my latest (non-deleted) match to 'rejected' when mirror user dismissed ===
    if (fn === 'mirror_rejected') {
      try {
        const matchId = body?.match_id as string | number | undefined;

        if (matchId) {
          const { error: upByIdErr } = await supabase
            .from('matches')
            .update({ status: 'rejected' })
            .eq('id', matchId as any)
            .eq('user_id', userId)
            .neq('status', 'deleted'); // sécurité: n'écrase pas un deleted

          if (upByIdErr) {
            console.error('❌ [mirror_rejected] update by id failed:', upByIdErr?.message);
            return NextResponse.json({ error: 'Failed to mark rejected (by id)' }, { status: 500 });
          }

          return NextResponse.json({ success: true, fn: 'mirror_rejected', match_id: matchId });
        }

        // Sinon: on prend le DERNIER match non supprimé de l'utilisateur
        const { data: last, error: lastErr } = await supabase
          .from('matches')
          .select('id, status')
          .eq('user_id', userId)
          .neq('status', 'deleted')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastErr) {
          console.error('❌ [mirror_rejected] fetch latest failed:', lastErr?.message);
          return NextResponse.json({ error: 'Failed to fetch latest match' }, { status: 500 });
        }
        if (!last?.id) {
          return NextResponse.json({ error: 'No match to mark rejected' }, { status: 404 });
        }

        const { error: upErr } = await supabase
          .from('matches')
          .update({ status: 'rejected' })
          .eq('id', last.id)
          .eq('user_id', userId)
          .neq('status', 'deleted');

        if (upErr) {
          console.error('❌ [mirror_rejected] update failed:', upErr?.message);
          return NextResponse.json({ error: 'Failed to mark rejected' }, { status: 500 });
        }

        return NextResponse.json({ success: true, fn: 'mirror_rejected', match_id: last.id });
      } catch (e) {
        console.error('❌ [mirror_rejected] unexpected error:', e);
        return NextResponse.json({ error: 'Server error (mirror_rejected)' }, { status: 500 });
      }
    }

    // === NOUVELLE BRANCHE: envoyer un message — PATCH /api/ask  { fn: "chat_send", match_id, content }
    if (fn === "chat_send") {
      try {
        const matchId = body?.match_id as string | undefined;
        let content = body?.content as string | undefined;

        if (!matchId) {
          return NextResponse.json({ error: "Missing match_id" }, { status: 400 });
        }
        if (typeof content !== "string") {
          return NextResponse.json({ error: "Invalid content" }, { status: 400 });
        }
        content = content.trim();
        if (content.length < 1 || content.length > 4000) {
          return NextResponse.json({ error: "Message length must be 1..4000" }, { status: 400 });
        }

        const token = getBearerToken(req);
        if (!token) {
          return NextResponse.json({ error: "Unauthorized: no token" }, { status: 401 });
        }
        const userClient = createUserClientWithToken(token);

        const { data, error } = await userClient.rpc("chat_send", {
          p_match_id: matchId,
          p_body: content,
        });

        if (error) {
          // Les fonctions SQL utilisent des erreurs 42501 (forbidden), 22023 (invalid)
          const code = (error as any)?.code || "";
          const status = code === "42501" ? 403 : 400;
          console.error("❌ chat_send RPC failed:", error);
          return NextResponse.json({ error: (error as any)?.message || "Failed to send message" }, { status });
        }

        return NextResponse.json({
          success: true,
          message: {
            id: data?.id,
            user_a: data?.user_a,
            user_b: data?.user_b,
            sender_id: data?.sender_id,
            body: data?.body,
            attachments: data?.attachments ?? [],
            created_at: data?.created_at,
            edited_at: data?.edited_at ?? null,
            deleted_at: data?.deleted_at ?? null,
          },
        });
      } catch (e) {
        console.error("❌ [chat_send] unexpected error:", e);
        return NextResponse.json({ error: "Server error (chat_send)" }, { status: 500 });
      }
    }

    const {
      birthdate,
      gender,
      orientation_preference,
      age_min,
      age_max,
      distance_max_km,
      location,
      relationship, // << EXISTANT
      strictness_level, // << NEW (int 1..3)
      step_index,
    }: {
      birthdate?: string;
      gender?: "Man" | "Woman" | string;
      orientation_preference?: "Man" | "Woman" | "Both" | string;
      age_min?: number;
      age_max?: number;
      distance_max_km?: number;
      location?: { lat?: number; lng?: number; accuracy?: number; [k: string]: any };
      relationship?: "serious" | "open" | "casual" | string;
      strictness_level?: number; // 1 | 2 | 3
      step_index?: number
    } = body ?? {};

    /* ---------- 0) Helpers de validation distance (miroir du slider front) ---------- */
    const DIST_NO_LIMIT = 5001;
    const allowedDistances = (() => {
      const vals: number[] = [];
      // 1..100 (pas 1)
      for (let i = 1; i <= 100; i++) vals.push(i);
      // 110..1000 (pas 10)
      for (let d = 110; d <= 1000; d += 10) vals.push(d);
      // 1100..3000 (pas 100)
      for (let d = 1100; d <= 3000; d += 100) vals.push(d);
      // 3500, 4000, 4500, 5000
      vals.push(3500, 4000, 4500, 5000);
      // 5001 = No limit
      vals.push(DIST_NO_LIMIT);
      return new Set(vals);
    })();

    const updateProfileData: Record<string, any> = {};
    let hasProfileUpdate = false;

    /* ---------- 1) users.birthdate (inchangé) ---------- */
    if (birthdate !== undefined) {
      if (typeof birthdate !== "string") {
        return NextResponse.json({ error: "Invalid birthdate" }, { status: 400 });
      }
      const { error: birthErr } = await supabase
        .from("users")
        .update({ birthdate })
        .eq("id", userId);
      if (birthErr) {
        console.error("❌ Error updating birthdate:", birthErr);
        return NextResponse.json({ error: "Failed to update birthdate" }, { status: 500 });
      }
    }

    /* ---------- 2) user_profiles: orientation + age ---------- */
    // ✅ Nouveau: gender en minuscules ("man" | "woman")
    if (gender !== undefined) {
      const g = typeof gender === "string" ? gender.toLowerCase() : "";
      if (g === "man" || g === "woman") {
        updateProfileData.gender = g;
        hasProfileUpdate = true;
      } else {
        return NextResponse.json({ error: "Invalid gender" }, { status: 400 });
      }
    }

    // ✅ Nouveau: orientation_preference en format "seek_*"
    // Compat: si on reçoit "man" | "woman" | "both", on mappe vers "seek_man" | "seek_woman" | "seek_both"
    if (orientation_preference !== undefined) {
      const raw = typeof orientation_preference === "string" ? orientation_preference.toLowerCase() : "";
      const normalized =
        raw.startsWith("seek_") ? raw :
        raw === "man" ? "seek_man" :
        raw === "woman" ? "seek_woman" :
        raw === "both" ? "seek_both" : "";

      if (normalized === "seek_man" || normalized === "seek_woman" || normalized === "seek_both") {
        updateProfileData.orientation_preference = normalized;
        hasProfileUpdate = true;
      } else {
        return NextResponse.json({ error: "Invalid orientation_preference" }, { status: 400 });
      }
    }

    if (
      typeof age_min === "number" &&
      typeof age_max === "number" &&
      Number.isFinite(age_min) &&
      Number.isFinite(age_max) &&
      age_min < age_max
    ) {
      updateProfileData.age_min = age_min;
      updateProfileData.age_max = age_max;
      hasProfileUpdate = true;
    } else if (age_min !== undefined || age_max !== undefined) {
      // Si l'un des deux est fourni mais que le couple est invalide, on renvoie 400
      if (!(typeof age_min === "number" && typeof age_max === "number" && age_min < age_max)) {
        return NextResponse.json({ error: "Invalid age range" }, { status: 400 });
      }
    }

    /* ---------- 2.bis) relationship (enum relationship_type) ---------- */
    if (relationship !== undefined) {
      const rel = typeof relationship === "string" ? relationship.toLowerCase() : "";
      if (rel === "serious" || rel === "open" || rel === "casual") {
        // En base: user_profiles.relationship :: public.relationship_type
        updateProfileData.relationship = rel;
        hasProfileUpdate = true;
      } else {
        return NextResponse.json({ error: "Invalid relationship" }, { status: 400 });
      }
    }

    /* ---------- 2.ter) NEW: strictness_level (int 1..3) ---------- */
    if (strictness_level !== undefined) {
      const valid = strictness_level === 1 || strictness_level === 2 || strictness_level === 3;
      if (typeof strictness_level !== "number" || !Number.isFinite(strictness_level) || !valid) {
        return NextResponse.json({ error: "Invalid strictness_level" }, { status: 400 });
      }
      updateProfileData.strictness_level = strictness_level;

      // ✅ On marque aussi profile_done à true
      updateProfileData.profile_done = true;

      hasProfileUpdate = true;
    }

    /* ---------- 2.quater) NEW: step_index (int 1..10) ---------- */
    if (step_index !== undefined) {
      const isNum = typeof step_index === "number" && Number.isFinite(step_index);
      const isInt = isNum && Math.trunc(step_index) === step_index;
      if (!isInt || step_index < 1 || step_index > 10) {
        return NextResponse.json({ error: "Invalid step_index" }, { status: 400 });
      }
      updateProfileData.step_index = step_index;
      hasProfileUpdate = true;
    }

    /* ---------- 3) distance_max_km (validation stricte) ---------- */
    if (distance_max_km !== undefined) {
      if (
        typeof distance_max_km !== "number" ||
        !Number.isFinite(distance_max_km) ||
        !allowedDistances.has(distance_max_km)
      ) {
        return NextResponse.json(
          { error: "Invalid distance_max_km" },
          { status: 400 }
        );
      }
      updateProfileData.distance_max_km = distance_max_km;
      hasProfileUpdate = true;
    }

    /* ---------- 4) location {lat,lng,accuracy} ---------- */
    if (location !== undefined) {
      const lat = location?.lat;
      const lng = location?.lng;
      const accuracy = location?.accuracy;

      // lat/lng requis ensemble si location est présent
      const latOk =
        typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
      const lngOk =
        typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;

      if (!latOk || !lngOk) {
        return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
      }

      // accuracy: on accepte toute valeur numérique finie >= 0
      let accToSave: number | null = null;
      if (accuracy !== undefined) {
        if (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0) {
          return NextResponse.json({ error: "Invalid accuracy" }, { status: 400 });
        }
        accToSave = accuracy;
      }

      // ⚠️ Mapping colonnes (user_profiles) : latitude, longitude, accuracy
      updateProfileData.latitude = lat;
      updateProfileData.longitude = lng;
      if (accToSave !== null) updateProfileData.accuracy = accToSave;

      hasProfileUpdate = true;
    }

    /* ---------- 5) Upsert user_profiles si nécessaire ---------- */
    if (hasProfileUpdate) {
      const { error: profileErr } = await supabase
        .from("user_profiles")
        .upsert({ user_id: userId, ...updateProfileData }, { onConflict: "user_id" });

      if (profileErr) {
        console.error("❌ Error updating user_profiles:", profileErr);
        return NextResponse.json(
          { error: "Failed to update user profile" },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    const status = err?.status || 500;
    const message = err?.message || "Server error";
    console.error("❌ [PATCH /api/ask] error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
