import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowRight } from 'lucide-react'
import { PRACTICE_GUIDES } from '@/lib/practice-content'
import PublicNav from '@/components/PublicNav'
import SiteFooter from '@/components/SiteFooter'

export const metadata: Metadata = {
  title: 'Mock Interview Practice Guides by Company & Role — Intervizly',
  description:
    'Free company-specific mock interview practice. Sample questions and tips for Google, Amazon, Flipkart, TCS, Infosys and more — then practise live with AI.',
  alternates: { canonical: '/practice' },
}

export default function PracticeIndexPage() {
  return (
    <div className="min-h-screen bg-white">
      <PublicNav />

      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
          Company interview practice guides
        </h1>
        <p className="text-lg text-gray-600 mb-10 max-w-2xl">
          Real sample questions and how-to-answer tips for the companies people actually interview
          at — then practise a full voice mock interview with AI feedback.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {PRACTICE_GUIDES.map((g) => (
            <Link
              key={g.slug}
              href={`/practice/${g.slug}`}
              className="border border-gray-200 rounded-2xl p-5 hover:border-indigo-300 hover:shadow-md transition-all group"
            >
              <div className="text-xs text-indigo-600 font-medium mb-1">{g.roundLabel}</div>
              <div className="font-semibold text-gray-900 text-lg mb-1">
                {g.company} — {g.role}
              </div>
              <p className="text-sm text-gray-500 mb-3 line-clamp-2">{g.metaDescription}</p>
              <span className="inline-flex items-center gap-1 text-sm text-indigo-600 font-medium">
                View questions <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </Link>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  )
}
