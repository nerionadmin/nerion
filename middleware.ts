// middleware.ts
import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createMiddlewareClient({ req, res })
  // Rafraîchit/attache les cookies de session si besoin
  await supabase.auth.getSession()
  return res
}

export const config = {
  matcher: ['/', '/(api|app)(.*)'], // assure que /api/... reçoit les cookies
}
