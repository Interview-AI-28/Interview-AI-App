# Intervizly — Architecture & Build Reference

> A complete, build-from-scratch reference for **Intervizly**, an AI-powered voice mock-interview platform for the Indian job market. This document is the source of truth: with it alone you can recreate the app end to end.

---

## 1. What the product does

A candidate signs in, describes a target job (company, role, JD, years of experience) and picks an interview round type. The app generates a tailored 15-question interview, then runs a **live voice interview**: an AI interviewer speaks each question aloud, the candidate answers by voice, speech is transcribed in real time, each answer is scored and can be probed deeper, and difficulty adapts to performance. At the end the candidate gets a detailed scorecard (overall score, selection probability, per-question feedback with ideal-answer hints, communication metrics, strengths/gaps) plus a post-interview AI coach chat. It is **free and unlimited**. There is also a lightweight **drill mode** for quick single-question practice, a **streak/countdown** motivation layer, **public shareable report links**, and an **org/cohort dashboard** for placement cells.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 14** (App Router) | Single deployable: SSR pages + API routes + client components |
| Language | **TypeScript** (strict) | React 18 |
| Styling | **Tailwind CSS** + `tailwindcss-animate` | Radix UI primitives, `framer-motion`, `lucide-react` icons |
| Hosting | **Vercel** | Serverless functions, Vercel Cron, preview deploys |
| DB + Auth | **Supabase** (Postgres + Auth + RLS) | Google OAuth; Row-Level Security on every table |
| LLM | **Anthropic Claude** | `claude-sonnet-4-6` (questions + reports), `claude-haiku-4-5` (live eval, intro, coach, drill) |
| Speech-to-text | **Deepgram** | `nova-2-general`, live WebSocket streaming |
| Text-to-speech | **ElevenLabs** | Named voices per persona; browser `SpeechSynthesis` fallback |
| Email | **Resend** | Welcome, feedback report, streak/re-engagement nudges |
| Rate limiting | **Upstash Redis** (`@upstash/ratelimit`) | In-process sliding-window fallback when unset |
| Analytics | **PostHog** | Pageviews only; autocapture + session recording OFF |
| Errors | **Sentry** | `sendDefaultPii: false` client + server |
| Push | **Web Push (VAPID)** | `web-push` |
| Resume parsing | `pdf-parse` (PDF), `mammoth` (DOCX) | Also Google Drive/Docs URL import |
| Anti-abuse | `@fingerprintjs/fingerprintjs` | Soft device-fingerprint signal |

> **Note on legacy columns:** the schema still contains payment/referral/phone-verification fields (`credit_balance`, `plan`, `subscriptions`, `razorpay_*`, `phone_*`, `referrals`). The product is now **fully free** — these are dormant. A from-scratch rebuild can omit them entirely (see §6 "Minimal schema").

---

## 3. High-level architecture

```
┌─────────────────────────── Browser ───────────────────────────┐
│  Next.js client components                                     │
│   • /auth/login  (Google Identity Services + redirect fallback)│
│   • /interview/session/[id]  (voice state machine)            │
│      ├─ WebSocket → Deepgram (live STT)                        │
│      ├─ fetch /api/tts → ElevenLabs audio (or browser TTS)     │
│      └─ fetch /api/evaluate-answer, /api/skip-question         │
│   • dashboard / feedback / drill / account / org (SSR + client)│
│  PostHog (pageviews) · Sentry (errors, no PII)                 │
└───────────────┬───────────────────────────────────────────────┘
                │ HTTPS
┌───────────────▼─────────── Vercel (Next.js server) ───────────┐
│  Middleware: auth gate on /dashboard /interview /account /org  │
│  API routes (src/app/api/*)  ← "the backend"                   │
│  Server Components (SSR data fetch via Supabase server client) │
│  Vercel Cron → /api/cron/nudge (daily)                         │
└───┬────────┬────────┬────────┬────────┬────────┬───────────────┘
    │        │        │        │        │        │
 Supabase  Claude  Deepgram ElevenLabs Resend  Upstash
 (PG+Auth) (LLM)   (STT)    (TTS)     (email)  (rate limit)
```

**Two Supabase clients (critical distinction):**
- **Server client** (`createServerSupabaseClient`) — cookie-bound, respects RLS. Used for all normal user-scoped reads/writes.
- **Service client** (`createServiceClient`) — service-role key, **bypasses RLS**. Used *only* for: cross-user aggregation (`/org`), public report reads by token (`/report/[token]`), account deletion, and post-auth profile re-hydration.

---

## 4. Directory layout

```
src/
├── middleware.ts                 # Auth gate (matcher: dashboard/interview/account/org)
├── instrumentation.ts            # Sentry server init (sendDefaultPii:false)   [root: instrumentation.ts]
├── app/
│   ├── layout.tsx                # Root layout, metadata, PostHog/Sentry providers
│   ├── providers.tsx             # PostHog + Sentry client init (PII-hardened)
│   ├── page.tsx                  # Marketing landing page
│   ├── globals.css
│   ├── auth/
│   │   ├── login/page.tsx        # GIS ID-token sign-in + redirect fallback
│   │   └── callback/route.ts     # OAuth PKCE code exchange (fallback path)
│   ├── dashboard/                # Home: stats, streak, countdown, history, onboarding
│   ├── interview/
│   │   ├── setup/page.tsx        # Company/role/JD/experience/round + resume upload
│   │   ├── session/[sessionId]/  # THE voice interview state machine
│   │   └── feedback/[sessionId]/ # Scorecard + per-question + coach chat
│   ├── drill/page.tsx            # Quick single-question practice (browser STT)
│   ├── account/page.tsx          # Profile, data export, delete account
│   ├── org/page.tsx              # Cohort analytics (admin-only, service client)
│   ├── report/[token]/           # Public shareable report (no auth) + OG image
│   ├── practice/                 # SEO practice guides (static content)
│   ├── privacy/ · terms/         # Legal pages
│   └── api/                      # See §7 for full route inventory
├── components/                   # Logo, PublicNav, SiteFooter, FadeIn, Stagger, PageTransition
├── lib/                          # See §5
└── types/index.ts                # All shared TypeScript types
supabase/                         # schema.sql + incremental migrations
vercel.json                       # Cron schedule
```

---

## 5. Core library modules (`src/lib`)

| File | Responsibility |
|---|---|
| `supabase.ts` | Browser Supabase client (`createBrowserClient`) |
| `supabase-server.ts` | `createServerSupabaseClient` (RLS, cookie-bound) + `createServiceClient` (service-role) |
| `anthropic-client.ts` | Lazily-initialized Anthropic SDK client via Proxy — never throws at import time if key missing |
| `scrub-pii.ts` | Regex redaction of emails/phones/URLs. Applied before every LLM call and before storage |
| `feedback-generation.ts` | Report generation: single-flight dedup, LLM narrative, **deterministic scoring**, email send |
| `personas.ts` | 5 interviewer personas (names, styles, voice IDs) + `PERSONA_SPEECH_STYLE` for live reactions |
| `rate-limit.ts` | Upstash sliding-window (per `(max,window)` config) with in-process fallback |
| `post-auth.ts` | Shared post-sign-in side effects (welcome email, deleted-profile re-hydration) |
| `drill-questions.ts` | Static date-seeded drill question bank + types |
| `practice-content.ts` | SEO practice-guide content (company-specific) |
| `round-badges.ts` | Round-type color/label mapping for UI |
| `push-client.ts` / `push-server.ts` | Web Push subscribe (browser) / send (VAPID, server) |
| `audio-storage.ts` | Client helper for recording state (no audio is persisted server-side) |
| `utils.ts` | `getScoreColor`, `getProbabilityLabel`, `generateShareToken`, `normalizeTopic`, `escapeHtml` |

### PII scrubbing (`scrub-pii.ts`) — reproduce exactly
```ts
const URL_RE   = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /\+?(?:\d[\s\-().]*){9,14}\d/g   // 10–15 digits
export function scrubPII(text: string): string {
  if (!text) return text
  return text.replace(URL_RE,'[link removed]').replace(EMAIL_RE,'[email removed]').replace(PHONE_RE,'[phone removed]')
}
```
Order matters: URLs first (can contain @ and digits), then emails, then phones. Names are **not** scrubbed (unreliable, corrupts technical content).

---

## 6. Data model (Supabase Postgres)

### Minimal schema (what a free rebuild actually needs)

```
users              id (=auth.users.id), email, name, avatar_url,
                   current_streak, longest_streak, last_session_date,
                   device_fingerprint, created_at
interview_sessions id, user_id→users, company, role, jd_text,
                   experience_years, round_type[enum], status[enum],
                   started_at, ended_at, created_at
questions          id, session_id→sessions, text, round_type, difficulty(1-5),
                   topic_tag, order_index, asked(bool), expected_keywords(text[])
answers            id, session_id, question_id, transcript_text,
                   duration_seconds, score(1-5), recorded_at
feedback_reports   id, session_id(UNIQUE), overall_score(0-100),
                   selection_probability(0-100), strengths_json, gaps_json,
                   per_question_json, communication_score, communication_json,
                   report_text, share_token(UNIQUE), emailed_at, created_at
weak_areas         id, user_id, topic_tag, avg_score(numeric), session_count,
                   last_updated, UNIQUE(user_id,topic_tag)
push_subscriptions user_id, endpoint, keys...  (from migration)
user_feedback      user_id, rating, suggestions  (from migration)
organizations      id, name, type            (org feature)
organization_members org_id, user_id, role
```

**Enums:**
- `round_type`: `tech_l1 | tech_l2 | managerial | hr | full_loop`
- `session.status`: `setup | in_progress | completed | abandoned`

### Row-Level Security (mandatory — the app relies on it, not just the API layer)
- Enable RLS on **every** table.
- `users`: `SELECT` own row only (`auth.uid() = id`). **No client write policy** — profile writes are server-side only.
- `interview_sessions`, `weak_areas`: `USING (auth.uid() = user_id)`.
- `questions`, `answers`, `feedback_reports`: scoped via subquery `session_id IN (SELECT id FROM interview_sessions WHERE user_id = auth.uid())`.
- **Do NOT** add a `share_token IS NOT NULL` read policy on `feedback_reports` — because the column is NOT NULL, that predicate is always true and leaks every report. Public reads use the **service client filtered by exact token** instead.
- `organizations`/`organization_members`: members can read their own membership; admin aggregation uses the service client.

### Trigger: auto-create profile
`handle_new_user()` fires `AFTER INSERT ON auth.users` → inserts a `public.users` row (name/avatar from `raw_user_meta_data`). It only fires on the *first-ever* signup; returning deleted users are re-hydrated in `post-auth.ts` instead.

### Indexes
Index every foreign key used in filters: `sessions(user_id)`, `sessions(status)`, `questions(session_id)`, `answers(session_id)`, `answers(question_id)`, `feedback_reports(session_id)`, `feedback_reports(share_token)`, `weak_areas(user_id)`.

---

## 7. API route inventory (`src/app/api`)

Every route authenticates first (`supabase.auth.getUser()`, or `CRON_SECRET`/`DEV_TOOLS_SECRET` bearer). All fail closed.

| Route | Method | Purpose | LLM / External | Rate limit |
|---|---|---|---|---|
| `generate-questions` | POST | 15 tailored questions from JD+resume (resume scrubbed, never stored) | Claude Sonnet | 10 setups/hr |
| `interview-intro` | POST | Spoken small-talk reactions (steps 1 & 3) | Claude Haiku | 60/hr |
| `evaluate-answer` | POST | Score 1-5, decide probe/skip, pick next question (adaptive), pre-gen report on last Q | Claude Haiku | 300/hr |
| `skip-question` | POST | Mark asked, return next unasked (same adaptive pool) | — | — |
| `end-session` | POST | Idempotent `in_progress→completed` transition | — | — |
| `generate-feedback` | POST | Thin wrapper → `feedback-generation.ts` | Claude Sonnet | — |
| `tts` | POST | ElevenLabs speech; voice resolution + model fallback chain | ElevenLabs | 300/hr |
| `deepgram-token` | GET | Mint short-lived (2h) Deepgram key, scope `usage:write` | Deepgram | — |
| `interview-coach` | POST | Streaming (SSE) post-interview coach chat (scrubbed) | Claude Haiku | 50/hr |
| `parse-resume` | POST | PDF/DOCX/Drive-URL → text (5 MB cap) | pdf-parse/mammoth | 20/hr |
| `drill-questions` | POST | Personalized drill set (falls back to static) | Claude Haiku | yes |
| `drill-evaluate` | POST | Score a single drill answer (scrubbed) | Claude Haiku | 30/hr |
| `study-plan` | POST | Personalized plan from weak areas/history | Claude | yes |
| `session-data/[sessionId]` | GET | Load session; `setup→in_progress`; returns `{completed:true}` if done; `answered_count` for refresh-safe numbering | — | 10 starts/hr |
| `submit-feedback` | POST | Star rating + suggestions (upsert) | — | — |
| `account-data` | GET | Data export for the user | — | — |
| `delete-account` | POST | Scrub PII, cascade-delete sessions, clear fingerprint/phone | service client | — |
| `fingerprint` | POST | Store device fingerprint (soft anti-abuse) | service client | — |
| `push/subscribe` | POST | Save Web Push subscription | — | — |
| `post-signin` | POST | Post-auth side effects for GIS flow (welcome email, re-hydration) | service client | — |
| `cron/nudge` | GET | Daily streak/re-engagement emails + push (`CRON_SECRET`) | Resend + push | — |
| `test-tts`, `debug-voices` | GET | ElevenLabs diagnostics (`DEV_TOOLS_SECRET` bearer, fail closed) | ElevenLabs | — |

---

## 8. The interview flow (the heart of the app)

### 8.1 Setup → question generation
1. `/interview/setup`: user enters company, role, JD (≤6000 chars), experience, round type; optionally uploads a resume (→ `/api/parse-resume`).
2. `POST /api/generate-questions`: **scrub** resume + JD → Claude Sonnet prompt (system prompt enforces: voice-first questions, one at a time, ≤40 words, difficulty ramps 2→4/5, controlled `topic_tag` vocabulary per round). Generate questions **before** inserting the session row (avoids orphaned rows on LLM failure). Store `jd_text` (scrubbed) only — **resume text is never persisted**. Insert 15 `questions`; resume-grounded ones tagged with `__resume` in `expected_keywords`.

### 8.2 The live session state machine (`/interview/session/[sessionId]/page.tsx`)
Client-side audio state: `IDLE | AI_SPEAKING | LISTENING | USER_SPEAKING | PROCESSING`. Phases: `intro → interview`.

**Connection:** `GET /api/deepgram-token` → open WebSocket to Deepgram:
```
wss://api.deepgram.com/v1/listen?model=nova-2-general&language=en-IN
  &punctuate=true&interim_results=true&vad_events=true
  &endpointing=3000&utterance_end_ms=3000&encoding=linear16&sample_rate=<ctx>&channels=1
```
- `endpointing=3000` — 3s silence tolerance (interview answers have thinking pauses; 2s cut people off). A **Done** button covers early finishers.
- Audio: `AudioContext` → `ScriptProcessor` → Float32→Int16 PCM → WebSocket. `KeepAlive` ping every 8s.
- Reconnect: exponential backoff (2s/4s/8s), max 3 attempts, skip on codes 1000/1001 or when ending.

**Intro:** interviewer greets → "How are you feeling?" (step 1) → `POST /api/interview-intro` reacts + asks for self-intro (step 3) → reacts + bridges into Q1. Each has a scripted fallback so it never stalls.

**Answer loop:** Deepgram `UtteranceEnd`/`speech_final` (or Done button) → `POST /api/evaluate-answer`:
1. Scrub + cap transcript (3000 chars). Verify session + question ownership.
2. Claude Haiku scores 1-5, detects skip intent, optionally emits ONE probe, returns a one-sentence spoken reaction in persona voice.
3. **Dedup** answer insert (retry-safe). Mark question `asked`.
4. **Adaptive next question:** score ≥4 → nearest *harder* unasked; score ≤2 → nearest *easier*; else next in order.
5. **Probe:** if flagged and current isn't already a probe (`order_index !== 999`) and not a retry → insert a same-difficulty follow-up as next question (capped one per scripted question).
6. When `questions_remaining === 0` → `waitUntil(generateFeedbackForSession(...))` fires report generation **in the background** (no HTTP self-call) while the AI speaks its closing line.
7. Client speaks reaction + next question via `POST /api/tts`.

**Skip button** → `POST /api/skip-question` (server-side so it draws from the same unasked pool the adaptive picker uses; client-side indexing desynced after adaptive jumps).

**TTS with fallback:** `POST /api/tts` → ElevenLabs audio; resolve voice by env-var ID → account voice name → any account voice → premade Adam; try model chain (`eleven_flash_v2_5` → … → `eleven_monolingual_v1`). If the call fails or audio can't play → client falls back to browser `SpeechSynthesis` and shows a "Browser voice (TTS error)" badge. **The interview never goes silent.**

### 8.3 Report generation (`feedback-generation.ts`)
- **Single-flight:** in-process `Map<sessionId, Promise>` so the background pre-gen and the feedback page's request never both call the LLM. Cross-instance dupes caught by existing-report check + unique `session_id`.
- LLM (Claude Sonnet, `max_tokens: 8192`) produces the **narrative** (per-question feedback text, ideal-answer hints, strengths×3, gaps×3, communication assessment, summary).
- **Deterministic scoring (do this server-side, not from the LLM):**
  - Per-question `score` = the **live score** from `answers.score` (LLM narrative is matched by position; unanswered = 1).
  - `overall_score` = difficulty-weighted average of live scores mapped 1→0…5→100.
  - `selection_probability` = LLM estimate **clamped** to `[overall-20, overall+10]` so the two never contradict.
  - Communication metrics = LLM-assessed, clamped 0-100. Filler-word counts computed server-side and fed to the prompt.
- Persist report (upsert on `session_id`), generate `share_token`, mark session `completed` (guarded on `in_progress`), send feedback email (Resend), update `weak_areas` and streak.

### 8.4 Feedback page + coach
`/interview/feedback/[sessionId]` renders the scorecard; polls if the report isn't ready. A `sessionStorage` marker (`iai_pregen_<id>`) tells it the background pre-gen is running so it waits instead of triggering a duplicate. The **coach** (`/api/interview-coach`) streams SSE from Claude Haiku with the (scrubbed) transcript as context.

---

## 9. Authentication

**Primary: Google Identity Services (GIS) ID-token flow** (`/auth/login`)
- Loads `https://accounts.google.com/gsi/client`, renders Google's own branded button.
- Nonce pair: `sha256(nonce)` sent to Google, raw `nonce` to Supabase `signInWithIdToken({provider:'google', token, nonce})` — prevents token replay.
- On success → `POST /api/post-signin` (welcome email + deleted-profile re-hydration) → redirect to `/dashboard`.
- **Why:** the consent screen shows *your* domain ("Intervizly"), not Supabase's shared `*.supabase.co`. Requires `NEXT_PUBLIC_GOOGLE_CLIENT_ID` + `https://<yourdomain>` in the OAuth client's **Authorized JavaScript origins**.

**Fallback: redirect OAuth** (`supabase.auth.signInWithOAuth` → `/auth/callback`)
- Used when GIS isn't configured or the script fails. Consent screen shows the Supabase domain (cosmetic only). PKCE code exchange in `callback/route.ts`, cookies bound to the redirect response, then `handlePostAuth`.

**Middleware** (`src/middleware.ts`) validates the session on `/dashboard`, `/interview`, `/account`, `/org` and redirects unauthenticated users to `/auth/login`. Follows the exact `@supabase/ssr` cookie pattern (`NextResponse.next({request})` forwarding) to avoid the "takes 2-3 tries to sign in" bug.

---

## 10. Cross-cutting concerns

- **Privacy/PII:** scrub before every LLM call and before storage; resume text never stored; Sentry `sendDefaultPii:false` (client + `instrumentation.ts` server); PostHog `autocapture:false`, `disable_session_recording:true`, no `identify()`.
- **Rate limiting:** wrap every LLM/TTS route (see §7). Cache one limiter per `(max,window)` — a shared singleton would apply the first route's limits to all.
- **Email safety:** `escapeHtml()` all user-controlled strings (name/company/role/summary) before interpolating into email HTML.
- **Cost control:** generous per-user hourly caps far above real use; input length caps on every LLM prompt; questions generated before session insert.
- **Cron:** `vercel.json` schedules `/api/cron/nudge` daily (`30 2 * * *`), `CRON_SECRET`-gated.
- **Observability:** Sentry errors, PostHog pageviews only.

---

## 11. Environment variables

| Variable | Purpose | Public? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Service client (bypasses RLS) | ❌ |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | GIS sign-in (branded consent) | ✅ |
| `ANTHROPIC_API_KEY` | Claude | ❌ |
| `DEEPGRAM_API_KEY` / `DEEPGRAM_PROJECT_ID` | STT (mint scoped keys) | ❌ |
| `ELEVENLABS_API_KEY` | TTS | ❌ |
| `ELEVENLABS_VOICE_{TECH_L1,TECH_L2,MANAGERIAL,HR}[_F]` | Per-persona voice IDs (male/female) | ❌ |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | Email | ❌ |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Rate limiting (optional) | ❌ |
| `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | Analytics | ✅ |
| `NEXT_PUBLIC_SENTRY_DSN` | Errors | ✅ |
| `VAPID_PUBLIC_KEY`(`NEXT_PUBLIC_`) / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push | mixed |
| `CRON_SECRET` | Cron auth | ❌ |
| `DEV_TOOLS_SECRET` | Debug endpoints | ❌ |
| `NEXT_PUBLIC_APP_URL` | Canonical URL (metadata, emails, sitemap) | ✅ |

> `NEXT_PUBLIC_*` vars are inlined at **build time** — changing them requires a redeploy.

---

## 12. Build-from-scratch checklist

1. **Scaffold:** `create-next-app` (App Router, TS, Tailwind). Add deps from §2.
2. **Supabase:** create project → enable Google OAuth provider → run `schema.sql` (or the minimal schema in §6) → verify RLS policies and the `handle_new_user` trigger.
3. **Google Cloud:** create OAuth Web client → add your domain to Authorized JavaScript origins → add Supabase callback to Authorized redirect URIs → put the same Client ID in Supabase's Google provider *and* `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
4. **Types & lib:** create `types/index.ts` (§5 shapes), then the `lib/` modules — start with `supabase*.ts`, `anthropic-client.ts` (lazy Proxy), `scrub-pii.ts`, `rate-limit.ts`, `personas.ts`, `utils.ts`.
5. **Auth:** middleware + `/auth/login` (GIS + fallback) + `/auth/callback` + `post-auth.ts` + `/api/post-signin`.
6. **Interview pipeline (in order):** `generate-questions` → `session-data` → the session page state machine → `deepgram-token` → `tts` → `evaluate-answer` → `skip-question` → `feedback-generation.ts` → `generate-feedback` → feedback page → `interview-coach`.
7. **Supporting:** dashboard, drill, account (+ `delete-account`, `account-data`), org, public `report/[token]`, practice pages, privacy/terms.
8. **Cross-cutting:** rate limits on all LLM/TTS routes, PII scrubbing everywhere, PostHog/Sentry hardening, `escapeHtml` in emails, `vercel.json` cron.
9. **Verify:** `tsc --noEmit`, `next build`, then run a full interview end to end (TTS, transcription, probe, skip, report, coach).

---

## 13. Key design decisions worth preserving

- **Deterministic scores, LLM narrative.** Numbers come from live per-answer scores + difficulty weighting, never a second contradicting LLM opinion.
- **Background report pre-generation.** Fired from `evaluate-answer` on the last question via `waitUntil`, so the report is ready by the time the user reaches the feedback page.
- **Single-flight + sessionStorage marker.** Prevents duplicate LLM report generations across the answer path, the client, and the feedback page.
- **Server-side skip & adaptive picker share one pool.** Client-side indexing desynced after adaptive difficulty jumps.
- **Two-tier TTS.** ElevenLabs for quality, browser `SpeechSynthesis` as a zero-cost fallback so the interview is never silent.
- **RLS as the real boundary.** The API layer is not the only thing standing between a user and another user's data.
- **Fail-closed auth on every route**, including debug endpoints.
```
```
