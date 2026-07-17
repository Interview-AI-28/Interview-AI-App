/**
 * Redacts contact PII from user-supplied free text (résumés, job descriptions,
 * spoken-answer transcripts) before it is stored or included in an LLM prompt.
 *
 * Deliberately pattern-based: email addresses, phone numbers, and links are
 * reliably matchable, carry the highest re-identification risk, and are never
 * needed for question generation or answer evaluation. Names are not redacted —
 * detection is unreliable and false positives would corrupt technical content.
 *
 * Order matters: URLs first (they can contain @ and digits), then emails,
 * then phone numbers.
 */

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 10-15 digits with optional +country prefix and common separators — matches
// phone numbers while staying above the length of years, scores, and versions.
const PHONE_RE = /\+?(?:\d[\s\-().]*){9,14}\d/g

export function scrubPII(text: string): string {
  if (!text) return text
  return text
    .replace(URL_RE, '[link removed]')
    .replace(EMAIL_RE, '[email removed]')
    .replace(PHONE_RE, '[phone removed]')
}
