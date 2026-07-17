import Anthropic from '@anthropic-ai/sdk'

// Instantiated lazily on first use rather than at import time: a missing or
// misconfigured ANTHROPIC_API_KEY must surface as a catchable error inside a
// route's request handler (clean JSON 500), not crash the module graph of
// every route that imports this file — and `next build` must be able to
// collect page data in environments where the key isn't set.
let client: Anthropic | null = null

function getClient(): Anthropic {
  if (!client) {
    const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim()
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set')
    }
    client = new Anthropic({ apiKey })
  }
  return client
}

export const anthropicClient = new Proxy({} as Anthropic, {
  get(_target, prop) {
    const value = Reflect.get(getClient(), prop)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
