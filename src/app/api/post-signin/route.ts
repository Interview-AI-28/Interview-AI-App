import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { handlePostAuth } from '@/lib/post-auth'

// Called by the client immediately after a successful Google Identity Services
// sign-in (supabase.auth.signInWithIdToken), which — unlike the redirect-based
// OAuth flow — never passes through /auth/callback. Runs the same first-login
// side effects (deleted-profile re-hydration, welcome email) from that route.
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { origin } = new URL(request.url)
  await handlePostAuth(user, origin)

  return NextResponse.json({ ok: true })
}
