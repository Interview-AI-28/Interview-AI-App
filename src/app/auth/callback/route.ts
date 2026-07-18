import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { handlePostAuth } from '@/lib/post-auth'

// Handles the classic redirect-based OAuth flow (PKCE code exchange) — the
// fallback path when Google Identity Services isn't configured or fails to
// load. The primary sign-in path (src/app/auth/login/page.tsx) uses GIS's
// ID-token flow instead, which never redirects here.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  // Only allow same-origin relative paths. A value like "//evil.com" or
  // "https://evil.com" would otherwise turn the post-login redirect into an
  // open redirect (phishing / token-leak vector).
  const nextParam = searchParams.get('next') ?? '/dashboard'
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard'

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  // Bind the Supabase client's cookie writes to the redirect response we actually
  // return. Setting them via next/headers and returning a fresh NextResponse drops
  // the Set-Cookie headers, so the session wasn't persisted on the first try — that
  // was the "takes 2-3 attempts to sign in" loop.
  const response = NextResponse.redirect(`${origin}${next}`)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as never)
          )
        },
      },
    }
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(`${origin}/auth/login?error=auth_failed`)
  }

  if (data.user) {
    await handlePostAuth(data.user, origin)
  }

  return response
}
