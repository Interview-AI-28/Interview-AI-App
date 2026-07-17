import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-amber-600'
  return 'text-red-600'
}

export function getScoreBg(score: number): string {
  if (score >= 80) return 'bg-green-50 border-green-200'
  if (score >= 60) return 'bg-amber-50 border-amber-200'
  return 'bg-red-50 border-red-200'
}

export function getProbabilityLabel(prob: number): string {
  if (prob >= 75) return 'Strong candidate'
  if (prob >= 50) return 'Possible candidate'
  if (prob >= 25) return 'Needs improvement'
  return 'Not ready yet'
}

export function generateShareToken(): string {
  return crypto.randomUUID()
}

export function normalizeTopic(tag: string): string {
  return tag.toLowerCase().replace(/[\s-]+/g, '_')
}

// Escapes user-controlled strings before interpolation into email HTML.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
