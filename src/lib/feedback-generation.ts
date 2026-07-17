import { anthropicClient as client } from '@/lib/anthropic-client'
import { waitUntil } from '@vercel/functions'
import { Resend } from 'resend'
import { generateShareToken, escapeHtml } from '@/lib/utils'
import { scrubPII } from '@/lib/scrub-pii'
import type { Question, Answer, FeedbackJSON } from '@/types'
import type { createServerSupabaseClient } from '@/lib/supabase-server'

type SupabaseServer = Awaited<ReturnType<typeof createServerSupabaseClient>>

// Max chars per answer in the LLM prompt. 1500 chars ≈ 250 spoken words — generous
// enough to capture any complete answer, while preventing a single rambling response
// from bloating the prompt. The score itself is never affected (it was set by
// evaluate-answer which saw the full transcript in real time).
const MAX_ANSWER_CHARS = 1500

const FEEDBACK_SYSTEM_PROMPT = `You are an expert interview coach who provides detailed, specific feedback.
Analyse the complete interview transcript and generate a structured feedback report.

Return ONLY a valid JSON object with this exact structure:
{
  "overall_score": <0-100>,
  "selection_probability": <0-100>,
  "strengths": [
    {"title": "strength name", "example": "quote from their answer", "advice": "how to leverage this in future interviews"}
  ],
  "gaps": [
    {"title": "gap name", "example": "specific instance from answers", "advice": "concrete 1-2 sentence improvement action"}
  ],
  "per_question": [
    {
      "question_id": "uuid",
      "score": <1-5>,
      "feedback": "specific feedback referencing what they actually said",
      "ideal_answer_hint": "For scores 1-3: 2-3 bullet points (use • character) covering what a strong answer must include. For score 4: exactly one bullet (•) with the single upgrade that would make it a 5. Omit this field entirely for score 5."
    }
  ],
  "communication": {
    "score": <0-100, overall communication score>,
    "clarity": <0-100, how clearly ideas were expressed>,
    "clarity_note": "one concise sentence assessment",
    "pacing": <0-100, appropriate speed and rhythm — 100=perfect pacing>,
    "pacing_note": "one concise sentence assessment",
    "confidence": <0-100, assertiveness and conviction in delivery>,
    "confidence_note": "one concise sentence assessment",
    "filler_words": <0-100, where 100=no fillers at all, lower=more filler words>,
    "filler_note": "one concise sentence assessment"
  },
  "summary": "2-3 paragraph honest narrative assessment"
}

Rules:
- per_question score: copy the "Score given" value shown in the transcript for that question — these scores were assigned live during the interview and are final. Do NOT invent different scores.
- overall_score and selection_probability: estimates consistent with the per-question scores given (they are recomputed server-side from the live scores, so keep yours coherent with them)
- strengths: exactly 3, based on actual things said
- gaps: exactly 3, specific to what was actually said (or not said)
- Be specific — reference actual words and phrases used
- No generic feedback — every point must trace back to something in the transcript
- Be honest but constructive — this helps candidates improve
- ideal_answer_hint: scores 1-3 get 2-3 bullets; score 4 gets exactly one "make it a 5" bullet; score 5 gets none. Bullets start with •
- Tailor everything to the target role, company, and the candidate's experience level given in the interview details — a gap for a senior engineer ("no capacity estimates in your design") is not a gap for a fresher, and vice versa
- Every "advice" field must name a concrete next action the candidate can practise this week ("rehearse a 90-second STAR story about X", "explain Y out loud without notes"), never vague encouragement ("be more confident")
- filler_words score and filler_note: base them on the computed filler-word counts provided in the interview details — do not estimate your own counts
- summary: write it TO the candidate ("you"), open with the single most important takeaway, and end with the one change that would most improve their next interview`

// Best-effort single-flight per warm serverless instance: when the background
// pre-generation (fired from evaluate-answer) and the feedback page's request
// land on the same instance, the second caller awaits the first run instead of
// starting a duplicate LLM generation. Cross-instance duplicates are still
// caught by the existing-report check + unique-keyed upsert below.
const inFlight = new Map<string, Promise<GenerateFeedbackResult>>()

export interface GenerateFeedbackResult {
  report: Record<string, unknown>
  cached: boolean
}

export async function generateFeedbackForSession(
  supabase: SupabaseServer,
  userId: string,
  sessionId: string,
): Promise<GenerateFeedbackResult> {
  const existing = inFlight.get(sessionId)
  if (existing) return existing

  const run = generateInner(supabase, userId, sessionId)
    .finally(() => inFlight.delete(sessionId))
  inFlight.set(sessionId, run)
  return run
}

async function generateInner(
  supabase: SupabaseServer,
  userId: string,
  sessionId: string,
): Promise<GenerateFeedbackResult> {
  // Fetch session, questions, answers, and existing report in parallel.
  const [
    { data: session },
    { data: questions },
    { data: answers },
    { data: existingReport },
  ] = await Promise.all([
    supabase.from('interview_sessions').select('*').eq('id', sessionId).eq('user_id', userId).single(),
    supabase.from('questions').select('*').eq('session_id', sessionId).eq('asked', true).order('order_index'),
    supabase.from('answers').select('*').eq('session_id', sessionId).order('recorded_at'),
    supabase.from('feedback_reports').select('*').eq('session_id', sessionId).maybeSingle(),
  ])

  if (!session) {
    throw new FeedbackError('Session not found', 404)
  }

  // Dedup: if a report already exists (e.g. from the background pre-generation
  // fired by evaluate-answer when the last question was answered), return it.
  if (existingReport) {
    return { report: existingReport, cached: true }
  }

  const answerMap = new Map(
    (answers as Answer[] ?? []).map((a) => [a.question_id, a])
  )

  let feedback: FeedbackJSON

  if (!questions || questions.length === 0) {
    feedback = {
      overall_score: 0,
      selection_probability: 0,
      strengths: [
        { title: 'Showed up', example: 'Candidate initiated an interview session', advice: 'Complete the full interview to receive meaningful strengths feedback' },
      ],
      gaps: [
        { title: 'Interview not completed', example: 'No questions were answered in this session', advice: 'Try again and complete at least a few questions to get actionable feedback' },
      ],
      per_question: [],
      communication: {
        score: 0, clarity: 0, pacing: 0, confidence: 0, filler_words: 0,
        clarity_note: 'Interview not completed.',
        pacing_note: 'Interview not completed.',
        confidence_note: 'Interview not completed.',
        filler_note: 'Interview not completed.',
      },
      summary: 'This interview session ended before any questions were answered. No scored feedback can be generated. Start a new session and try to answer at least a few questions to receive a detailed report.',
    }
  } else {
    // Cap each answer at MAX_ANSWER_CHARS to keep prompt size bounded for long
    // interviews — a 15-question session with verbose answers can push input tokens
    // past 6 k, significantly slowing Haiku.
    const transcript = (questions as Question[]).map((q, i) => {
      const answer = answerMap.get(q.id)
      let answerText = answer?.transcript_text ? scrubPII(answer.transcript_text) : '[No answer provided]'
      if (answerText.length > MAX_ANSWER_CHARS) {
        answerText = answerText.slice(0, MAX_ANSWER_CHARS) + '… [truncated]'
      }
      return `Q${i + 1} [question_id:${q.id}, topic:${q.topic_tag}, difficulty:${q.difficulty}/5]:
"${q.text}"

Candidate's answer:
"${answerText}"
Score given: ${answer?.score ?? 'N/A'}/5
`
    }).join('\n---\n\n')

    // Deterministic filler-word counts from the real transcripts — fed to the LLM
    // as ground truth so its filler score can't contradict the per-question
    // regex counts the report UI shows.
    const FILLERS = ['um', 'uh', 'hmm', 'err', 'you know', 'i mean', 'kind of', 'sort of', 'basically']
    let fillerTotal = 0
    let fillerWords = 0
    for (const a of answers as Answer[] ?? []) {
      if (!a.transcript_text) continue
      const lower = a.transcript_text.toLowerCase()
      fillerWords += lower.split(/\s+/).filter(Boolean).length
      for (const f of FILLERS) {
        fillerTotal += (lower.match(new RegExp(`\\b${f.replace(' ', '\\s+')}\\b`, 'g')) ?? []).length
      }
    }

    const userMessage = `Interview Details:
Company: ${session.company}
Role: ${session.role}
Round: ${session.round_type}
Experience: ${session.experience_years} years
Questions asked: ${questions.length}
Computed filler-word counts: ${fillerTotal} filler words across ${fillerWords} spoken words total

Complete Interview Transcript:
${transcript}

Generate a comprehensive feedback report for this candidate.`

    const message = await client.messages.create({
      // Sonnet, not Haiku: the report is the product's core deliverable and
      // Sonnet's feedback is markedly more specific. It runs pre-generated in
      // the background, so the extra latency is invisible in the normal flow.
      model: 'claude-sonnet-4-6',
      // A 15-question full_loop with ideal_answer_hints on every low-scoring answer
      // easily exceeds 4096 output tokens — a lower limit silently truncated the JSON
      // mid-string, causing JSON.parse to throw and the report to never save.
      max_tokens: 8192,
      system: [
        {
          type: 'text',
          text: FEEDBACK_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    })

    const content = message.content[0]
    if (content.type !== 'text') throw new Error('Unexpected response type')

    try {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      feedback = JSON.parse(jsonMatch ? jsonMatch[0] : content.text)
    } catch {
      // Log the raw output so truncation is visible in Vercel logs
      console.error('Feedback parse failed. stop_reason:', message.stop_reason, '— output length:', content.text.length)
      throw new Error('Failed to parse feedback from AI')
    }

    // Haiku hit its token limit before closing the JSON — treat as a parse failure.
    // This is logged above; increasing max_tokens is the fix.
    if (message.stop_reason === 'max_tokens') {
      console.error('Haiku hit max_tokens limit during feedback generation — output truncated')
    }

    // ── Deterministic scoring ─────────────────────────────────────────────
    // The report's numbers derive from the per-answer scores assigned live
    // during the interview (answers.score, 1-5) — not from a second LLM
    // opinion that could contradict them. The LLM contributes the narrative
    // (feedback text, strengths, gaps, communication assessment); the maths
    // is done here.
    const orderedQuestions = questions as Question[]
    const llmPerQuestion = Array.isArray(feedback.per_question) ? feedback.per_question : []

    // Rebuild per_question so every asked question has exactly one entry,
    // keyed by position (the transcript is ordered and the LLM returns
    // entries in the same order), with the live score as the score of record.
    // An asked question with no recorded answer counts as 1 (no attempt).
    feedback.per_question = orderedQuestions.map((q, i) => {
      const llm = llmPerQuestion[i]
      const liveScore = answerMap.get(q.id)?.score ?? 1
      const entry: typeof llmPerQuestion[number] = {
        question_id: q.id,
        score: Math.min(5, Math.max(1, liveScore)),
        feedback: llm?.feedback?.trim()
          ? llm.feedback
          : 'No answer was recorded for this question, so no specific feedback is available.',
      }
      if (entry.score <= 4 && llm?.ideal_answer_hint) {
        entry.ideal_answer_hint = llm.ideal_answer_hint
      }
      return entry
    })

    // Overall score: difficulty-weighted average of the live scores mapped
    // onto 0-100 (score 1 → 0, score 5 → 100), so harder questions count for
    // more and the number is fully reproducible from actual performance.
    const weights = feedback.per_question.map((pq, i) => ({
      weight: orderedQuestions[i]?.difficulty ?? 3,
      normalized: ((pq.score - 1) / 4) * 100,
    }))
    const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)
    const computedOverall = totalWeight > 0
      ? Math.round(weights.reduce((sum, w) => sum + w.normalized * w.weight, 0) / totalWeight)
      : 0
    feedback.overall_score = computedOverall

    // Selection probability stays an LLM estimate (it legitimately weighs
    // things beyond raw scores) but is clamped to a band around the computed
    // overall so the two can never tell contradictory stories.
    const llmProbability = Number.isFinite(feedback.selection_probability)
      ? feedback.selection_probability
      : computedOverall
    feedback.selection_probability = Math.round(
      Math.min(Math.min(100, computedOverall + 10), Math.max(Math.max(0, computedOverall - 20), llmProbability))
    )

    // Communication metrics are LLM-assessed by design — just clamp to range.
    if (feedback.communication) {
      for (const key of ['score', 'clarity', 'pacing', 'confidence', 'filler_words'] as const) {
        const v = feedback.communication[key]
        feedback.communication[key] = Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0
      }
    } else {
      feedback.communication = {
        score: 0, clarity: 0, pacing: 0, confidence: 0, filler_words: 0,
        clarity_note: '', pacing_note: '', confidence_note: '', filler_note: '',
      }
    }
    if (!Array.isArray(feedback.strengths)) feedback.strengths = []
    if (!Array.isArray(feedback.gaps)) feedback.gaps = []
  }

  const shareToken = generateShareToken()

  // Save report + mark session completed — do these before responding. The
  // status update is guarded on 'in_progress' so it can never resurrect or
  // re-complete a session end-session already finalised.
  const [{ data: report, error: reportError }] = await Promise.all([
    supabase.from('feedback_reports').upsert({
      session_id: sessionId,
      overall_score: Math.min(100, Math.max(0, feedback.overall_score)),
      selection_probability: Math.min(100, Math.max(0, feedback.selection_probability)),
      strengths_json: feedback.strengths,
      gaps_json: feedback.gaps,
      per_question_json: feedback.per_question,
      communication_score: feedback.communication.score,
      communication_json: feedback.communication,
      report_text: feedback.summary,
      share_token: shareToken,
    }, { onConflict: 'session_id' }).select().single(),
    supabase.from('interview_sessions')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('id', sessionId)
      .eq('status', 'in_progress'),
  ])

  if (reportError) {
    console.error('Report save error:', reportError)
    throw new FeedbackError('Failed to save report', 500)
  }

  // Streak, weak areas, and email are all non-critical for the user to see
  // their report. Defer them with waitUntil so they complete after the
  // response is sent — removes ~4-5 s of blocking from the critical path.
  waitUntil(
    Promise.allSettled([
      updateStreak(supabase, userId),
      updateWeakAreas(supabase, userId, questions as Question[] ?? [], answerMap),
      sendFeedbackEmail(supabase, userId, session, feedback, sessionId, shareToken),
    ])
  )

  return { report: report as Record<string, unknown>, cached: false }
}

export class FeedbackError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// ── Side-effect helpers ────────────────────────────────────────────────────

async function updateStreak(supabase: SupabaseServer, userId: string) {
  const today = new Date().toISOString().slice(0, 10)
  const { data: currentUser } = await supabase
    .from('users')
    .select('current_streak, longest_streak, last_session_date')
    .eq('id', userId)
    .single()

  let newStreak = 1
  if (currentUser?.last_session_date) {
    const lastDate = new Date(currentUser.last_session_date + 'T00:00:00Z')
    const todayDate = new Date(today + 'T00:00:00Z')
    const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / 86400000)
    if (diffDays === 0) newStreak = currentUser.current_streak
    else if (diffDays === 1) newStreak = currentUser.current_streak + 1
  }
  const newLongest = Math.max(newStreak, currentUser?.longest_streak ?? 0)
  const { createServiceClient } = await import('@/lib/supabase-server')
  const svc = await createServiceClient()
  await svc
    .from('users')
    .update({ current_streak: newStreak, longest_streak: newLongest, last_session_date: today })
    .eq('id', userId)
}

async function updateWeakAreas(
  supabase: SupabaseServer,
  userId: string,
  questions: Question[],
  answerMap: Map<string, Answer>,
) {
  const topicGroups = new Map<string, number[]>()
  for (const q of questions) {
    const answer = answerMap.get(q.id)
    if (answer?.score != null) {
      const arr = topicGroups.get(q.topic_tag) ?? []
      arr.push(answer.score)
      topicGroups.set(q.topic_tag, arr)
    }
  }
  await Promise.all(Array.from(topicGroups.entries()).map(async ([topicTag, scores]) => {
    const sessionAvg = scores.reduce((a, b) => a + b, 0) / scores.length
    const { data: existing } = await supabase
      .from('weak_areas')
      .select('avg_score, session_count')
      .eq('user_id', userId)
      .eq('topic_tag', topicTag)
      .single()
    const existingCount = existing?.session_count ?? 0
    const newCount = existingCount + 1
    const newAvg = ((existing?.avg_score ?? 0) * existingCount + sessionAvg) / newCount
    const { error: upsertErr } = await supabase.from('weak_areas').upsert(
      { user_id: userId, topic_tag: topicTag, avg_score: Math.round(newAvg * 100) / 100, session_count: newCount, last_updated: new Date().toISOString() },
      { onConflict: 'user_id,topic_tag' }
    )
    if (upsertErr) console.error('weak_areas upsert error:', topicTag, upsertErr)
  }))
}

async function sendFeedbackEmail(
  supabase: SupabaseServer,
  userId: string,
  session: { company: string; role: string; [key: string]: unknown },
  feedback: FeedbackJSON,
  sessionId: string,
  shareToken: string,
) {
  void shareToken
  if (!process.env.RESEND_API_KEY) return

  const { data: userData } = await supabase.from('users').select('email, name').eq('id', userId).single()
  if (!userData?.email) return

  const resend = new Resend(process.env.RESEND_API_KEY)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://interview-ai-app-iota.vercel.app'

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL ?? 'Intervizly <intervizly@gmail.com>',
    to: userData.email,
    subject: `Your Interview Report — ${session.company} ${session.role} | Score: ${feedback.overall_score}/100`,
    html: buildEmailHtml({
      name: escapeHtml(userData.name ?? ''),
      company: escapeHtml(session.company ?? ''),
      role: escapeHtml(session.role ?? ''),
      score: feedback.overall_score,
      probability: feedback.selection_probability,
      summary: escapeHtml(feedback.summary ?? ''),
      reportUrl: `${appUrl}/interview/feedback/${sessionId}`,
    }),
  })

  await supabase.from('feedback_reports').update({ emailed_at: new Date().toISOString() }).eq('session_id', sessionId)
}

function buildEmailHtml({
  name, company, role, score, probability, summary, reportUrl,
}: {
  name: string; company: string; role: string; score: number; probability: number; summary: string; reportUrl: string
}) {
  const scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626'
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:20px;">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
    <div style="background:#4f46e5;padding:32px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:24px;">Intervizly</h1>
      <p style="color:#c7d2fe;margin:8px 0 0;">Your Interview Report is Ready</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;margin-bottom:24px;">Hi ${name},</p>
      <p style="color:#374151;margin-bottom:24px;">Your mock interview for <strong>${role} at ${company}</strong> is complete.</p>
      <div style="background:#f9fafb;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:48px;font-weight:bold;color:${scoreColor};">${score}</div>
        <div style="color:#6b7280;font-size:14px;">Overall Score / 100</div>
        <div style="margin-top:12px;font-size:18px;font-weight:600;color:#374151;">${probability}% chance of selection</div>
      </div>
      <p style="color:#374151;line-height:1.6;margin-bottom:24px;">${summary.split('\n')[0]}</p>
      <div style="text-align:center;">
        <a href="${reportUrl}" style="background:#4f46e5;color:white;text-decoration:none;padding:12px 32px;border-radius:8px;font-weight:600;display:inline-block;">View Full Report →</a>
      </div>
    </div>
    <div style="background:#f9fafb;padding:16px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Intervizly · Practice like it's real. Perform when it matters.</p>
    </div>
  </div>
</body>
</html>`
}
