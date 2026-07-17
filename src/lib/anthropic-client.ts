import Anthropic from '@anthropic-ai/sdk'

const rawKey = process.env.ANTHROPIC_API_KEY ?? ''
const apiKey = rawKey.trim()

if (!apiKey) {
  throw new Error('ANTHROPIC_API_KEY is not set')
}

export const anthropicClient = new Anthropic({ apiKey })
