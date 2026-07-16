import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

// TEMPORARY diagnostic endpoint for the "API key is invalid" 401.
// Gated behind login (any authenticated user). Reports only masked key
// metadata — never the key itself — and makes one real minimal call to
// Anthropic so we can see the exact status/error the app's key produces.
// Remove this route once the ANTHROPIC_API_KEY issue is resolved.
export async function GET() {
  // Require a logged-in user so this isn't world-readable
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized — log in first, then reload this URL' }, { status: 401 })
  }

  const rawKey = process.env.ANTHROPIC_API_KEY ?? ''
  const apiKey = rawKey.trim()
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN ?? ''

  const keyInfo = {
    present: apiKey.length > 0,
    length: apiKey.length,
    had_surrounding_whitespace: rawKey !== apiKey,
    starts_with_sk_ant: apiKey.startsWith('sk-ant-'),
    prefix: apiKey.slice(0, 8),
    suffix: apiKey.slice(-4),
    // A second auth env var causes the SDK to send BOTH headers → Anthropic 401s
    conflicting_ANTHROPIC_AUTH_TOKEN_also_set: authToken.length > 0,
  }

  if (!apiKey) {
    return NextResponse.json({
      status: 'error',
      problem: 'ANTHROPIC_API_KEY is not set in this deployment.',
      key_info: keyInfo,
      fix: 'Vercel → your project → Settings → Environment Variables → add ANTHROPIC_API_KEY (scope it to the environment this deployment runs in), then redeploy.',
    })
  }

  if (keyInfo.conflicting_ANTHROPIC_AUTH_TOKEN_also_set) {
    return NextResponse.json({
      status: 'error',
      problem: 'Both ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are set. The SDK sends both auth headers and Anthropic rejects the request with a 401 — even if the key itself is valid.',
      key_info: keyInfo,
      fix: 'Vercel → Settings → Environment Variables → DELETE ANTHROPIC_AUTH_TOKEN (keep only ANTHROPIC_API_KEY), then redeploy.',
    })
  }

  // Make one real, minimal call to Anthropic using the trimmed key directly,
  // so we see the exact status/body the key produces — independent of the SDK.
  let live: Record<string, unknown>
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    const bodyText = await res.text()
    live = {
      http_status: res.status,
      ok: res.ok,
      raw_response: bodyText.slice(0, 400),
    }
    if (res.ok) {
      return NextResponse.json({
        status: 'ok',
        diagnosis: 'The API key is VALID and reached Anthropic successfully. If interview generation still fails, the problem is elsewhere (not the key).',
        key_info: keyInfo,
        live,
      })
    }
    return NextResponse.json({
      status: 'error',
      diagnosis: res.status === 401
        ? 'Anthropic rejected the key with 401 — the key value is wrong: revoked, from a different/deleted workspace, a placeholder, or simply mistyped. This is a config value problem, not a code bug.'
        : `Anthropic returned HTTP ${res.status}. See raw_response for the reason.`,
      key_info: keyInfo,
      live,
      fix: res.status === 401
        ? 'Get a fresh key at https://console.anthropic.com/settings/keys (confirm the workspace has billing/credits), paste it into Vercel → Settings → Environment Variables → ANTHROPIC_API_KEY for the correct environment (no quotes/spaces), then redeploy.'
        : 'See raw_response.',
    })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      diagnosis: 'The request to Anthropic threw before getting a response (network/DNS/egress issue), so the key could not even be tested.',
      key_info: keyInfo,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
