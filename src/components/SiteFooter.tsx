import Link from 'next/link'

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 px-6 py-8">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-400">
        <span>© 2026 Intervizly. Made in India.</span>
        <div className="flex items-center gap-4">
          <Link href="/privacy" className="hover:text-gray-900 transition-colors">Privacy</Link>
          <Link href="/terms" className="hover:text-gray-900 transition-colors">Terms</Link>
        </div>
      </div>
    </footer>
  )
}
