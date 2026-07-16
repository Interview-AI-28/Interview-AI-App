import Anthropic from '@anthropic-ai/sdk'

const rawKey = process.env.ANTHROPIC_API_KEY ?? ''
const apiKey = rawKey.trim()

// TEMPORARY diagnostics for the "API key is invalid" 401 — remove once resolved.
// Logs only masked metadata, never the key itself.
console.log(
  '[anthropic-client] present:', apiKey.length > 0,
  'length:', apiKey.length,
  'had_whitespace:', rawKey !== apiKey,
  'prefix:', apiKey.slice(0, 7),
  'suffix:', apiKey.slice(-4)
)

if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY is not set')
}

export const anthropicClient = new Anthropic({ apiKey })
