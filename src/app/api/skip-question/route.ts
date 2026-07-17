import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { generateFeedbackForSession } from '@/lib/feedback-generation'
import type { Question } from '@/types'

// Skips the current question without an LLM evaluation: marks it asked (so the
// report counts it as a non-attempt) and returns the next unasked question from
// the same pool the adaptive picker in evaluate-answer draws from.
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { session_id, question_id } = await request.json() as {
      session_id: string
      question_id: string
    }
    if (!session_id || !question_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data: session } = await supabase
      .from('interview_sessions')
      .select('id')
      .eq('id', session_id)
      .eq('user_id', user.id)
      .single()
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const { data: question } = await supabase
      .from('questions')
      .select('id')
      .eq('id', question_id)
      .eq('session_id', session_id)
      .single()
    if (!question) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    const { error: askedError } = await supabase
      .from('questions')
      .update({ asked: true })
      .eq('id', question_id)
    if (askedError) {
      console.error('skip-question: failed to mark asked:', askedError)
      return NextResponse.json({ error: 'Failed to skip — please retry' }, { status: 500 })
    }

    const { data: remaining } = await supabase
      .from('questions')
      .select('*')
      .eq('session_id', session_id)
      .eq('asked', false)
      .order('order_index')

    const nextQuestion = (remaining as Question[] | null)?.[0] ?? null
    const questionsRemaining = remaining?.length ?? 0

    // Skipping the final question also ends the interview — start report
    // generation in the background, same as evaluate-answer does.
    if (questionsRemaining === 0) {
      waitUntil(
        generateFeedbackForSession(supabase, user.id, session_id).catch(() => {})
      )
    }

    return NextResponse.json({
      next_question: nextQuestion,
      questions_remaining: questionsRemaining,
    })
  } catch (error) {
    console.error('skip-question error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
