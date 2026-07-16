'use client'

import Link from 'next/link'
import { Mic, Heart, QrCode } from 'lucide-react'
import FadeIn from '@/components/FadeIn'

export default function PricingPage() {
  return (
    <div className="bg-slate-50 min-h-screen">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
              <Mic className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-gray-900">InterviewAI</span>
          </Link>
          <Link href="/dashboard" className="text-sm text-indigo-600 font-medium hover:text-indigo-700 transition-colors">
            Dashboard →
          </Link>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-6 py-16 text-center">
        <FadeIn>
          <span className="inline-flex items-center gap-1.5 bg-indigo-50 text-indigo-600 text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            Free &amp; unlimited
          </span>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Support this project</h1>
          <p className="text-gray-600 leading-relaxed mb-10 max-w-lg mx-auto">
            There&rsquo;s no paywall here — every feature is free and unlimited. If InterviewAI has
            helped you prep, you&rsquo;re welcome to send a token of thanks via UPI / Google Pay.
            Totally optional.
          </p>

          <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm inline-block">
            {/* TEMPORARY placeholder — swap for <Image src="/googlepay-qr.png" .../> once the real QR is added */}
            <div className="w-64 h-64 mx-auto bg-slate-50 border-2 border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center gap-2 text-gray-400">
              <QrCode className="w-10 h-10" />
              <span className="text-sm font-medium">QR code coming soon</span>
            </div>
            <p className="text-xs text-gray-400 mt-4">Scan with Google Pay or any UPI app</p>
          </div>

          <p className="text-sm text-gray-500 mt-8 flex items-center justify-center gap-1.5">
            <Heart className="w-4 h-4 text-indigo-400" />
            This project runs on good faith — pay what feels fair, or nothing at all.
            Thank you for practicing with us.
          </p>
        </FadeIn>
      </main>
    </div>
  )
}
