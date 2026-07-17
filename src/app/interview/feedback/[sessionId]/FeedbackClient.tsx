'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAnalytics } from '@/hooks/useAnalytics'

export default function FeedbackClient({
  sessionId,
  hasReport,
  overallScore,
  selectionProbability,
}: {
  sessionId: string
  hasReport: boolean
  overallScore?: number
  selectionProbability?: number
}) {
  const router = useRouter()
  const analytics = useAnalytics()
  const [timedOut, setTimedOut] = useState(false)
  const retriedRef = useRef(false)

  useEffect(() => {
    if (hasReport) {
      analytics.capture('feedback_viewed', {
        session_id: sessionId,
        overall_score: overallScore,
        selection_probability: selectionProbability,
      })
      return
    }
    if (timedOut) return

    // The session page sets a marker when the server already started generating
    // the report in the background (normal completion). In that case, hold the
    // fallback trigger for a while and let the 3 s poll pick up the pre-generated
    // report — firing immediately raced the in-flight run and produced a
    // duplicate LLM generation. Without the marker (early end, direct visit),
    // trigger right away.
    let pregen = false
    try {
      pregen = sessionStorage.getItem(`iai_pregen_${sessionId}`) === '1'
    } catch { /* ignore */ }

    let cancelled = false
    let triggerTimer: ReturnType<typeof setTimeout> | null = null
    if (!retriedRef.current) {
      retriedRef.current = true
      const trigger = async () => {
        try {
          const res = await fetch('/api/generate-feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId }),
          })
          try { sessionStorage.removeItem(`iai_pregen_${sessionId}`) } catch { /* ignore */ }
          if (res.ok && !cancelled) router.refresh()
        } catch { /* poll below is the safety net */ }
      }
      if (pregen) triggerTimer = setTimeout(trigger, 25000)
      else void trigger()
    }

    // Safety-net poll — covers the case where generation finished via the head-start
    // call but the await above errored (e.g. transient network).
    const pollInterval = setInterval(() => router.refresh(), 3000)

    // Give up showing "loading" after 60 s with a helpful message
    const giveUpTimer = setTimeout(() => setTimedOut(true), 60000)

    return () => {
      cancelled = true
      if (triggerTimer) clearTimeout(triggerTimer)
      clearInterval(pollInterval)
      clearTimeout(giveUpTimer)
    }
  }, [hasReport, timedOut, sessionId, overallScore, selectionProbability, analytics, router])

  if (!hasReport && timedOut) {
    return (
      <div className="mt-6 text-center">
        <div className="inline-block bg-amber-50 border border-amber-200 rounded-2xl px-6 py-4">
          <p className="text-sm text-amber-600 mb-3">
            Report is taking longer than expected.
          </p>
          <button
            onClick={() => {
              retriedRef.current = false
              setTimedOut(false)
              router.refresh()
            }}
            className="text-sm bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-500 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return null
}
