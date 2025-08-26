// lib/supabase.ts
import { createClient as createServerSDK } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

/**
 * Client navigateur (utilise @supabase/ssr pour synchroniser la session en cookies)
 */
export const supabaseBrowser = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

/**
 * Client serveur pour la BDD (Service Role, pas de session)
 */
export const supabaseServer = () =>
  createServerSDK(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      global: { fetch },
    }
  );
