import Link from 'next/link'

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 px-6 py-8">
      <div className="max-w-4xl mx-auto space-y-3">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-400">
          <span>© 2026 Intervizly. Made in India.</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacy</Link>
            <Link href="/terms" className="hover:text-gray-900 transition-colors">Terms</Link>
          </div>
        </div>
        <p className="text-xs text-gray-400 text-center sm:text-left">
          All interviews are AI-generated simulations for practice only. Intervizly is not
          affiliated with or endorsed by any company named on this site, and simulated
          interviews do not represent any company&apos;s actual interview process.
        </p>
      </div>
    </footer>
  )
}
