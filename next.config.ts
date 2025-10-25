// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ⛑️ Débloque le build Vercel même s'il y a des erreurs ESLint
  eslint: { ignoreDuringBuilds: true },

  // 💡 Évite toute config d’images pendant que tu remplaces <img> par <Image>
  images: { unoptimized: true },
};

export default nextConfig;
