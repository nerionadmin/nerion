"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HashToQuery() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    // hash: "#access_token=...&refresh_token=...&expires_in=..."
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    if (params.has("access_token")) {
      // Re-bascule vers /auth/callback en querystring (géré côté serveur)
      router.replace(`/auth/callback?${params.toString()}`);
    } else {
      router.replace("/");
    }
  }, [router]);

  return null;
}
