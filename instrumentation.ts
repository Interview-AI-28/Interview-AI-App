export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { init } = await import('@sentry/nextjs')
    init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
      // Explicitly off — no request headers, cookies, or IPs in error events,
      // and the Anthropic tracing integration must never record prompts.
      sendDefaultPii: false,
    })
  }
}
