import Anthropic from '@anthropic-ai/sdk'

const rawKey = process.env.ANTHROPIC_API_KEY ?? ''
const apiKey = rawKey.trim()

// TEMPORARY diagnostics for the "API key is invalid" 401 — remove once resolved.
// Returns only masked metadata, never the key itself. Also reports which Vercel
// environment/commit is actually serving the request, so we can tell whether the
// error is coming from Production or a Preview deployment.
export function getKeyDiagnostics() {
  const raw = process.env.ANTHROPIC_API_KEY ?? ''
  const key = raw.trim()
  return {
    vercel_env: process.env.VERCEL_ENV ?? 'unknown',
    git_ref: process.env.VERCEL_GIT_COMMIT_REF ?? 'unknown',
    git_sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown').slice(0, 7),
    key_present: key.length > 0,
    key_length: key.length,
    key_had_surrounding_whitespace: raw !== key,
    key_starts_with_sk_ant: key.startsWith('sk-ant-'),
    key_prefix: key.slice(0, 8),
    key_suffix: key.slice(-4),
    // A second auth env var makes the SDK send BOTH headers → Anthropic 401s
    conflicting_ANTHROPIC_AUTH_TOKEN_set: (process.env.ANTHROPIC_AUTH_TOKEN ?? '').length > 0,
  }
}

// One-time masked log on cold start (server logs only).
console.log('[anthropic-client]', getKeyDiagnostics())

if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY is not set')
}

export const anthropicClient = new Anthropic({ apiKey })
