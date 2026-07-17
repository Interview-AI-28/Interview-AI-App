import Link from 'next/link'
import Logo from './Logo'

export default function PublicNav({ children }: { children?: React.ReactNode }) {
  return (
    <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-200 px-6 py-4">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-4">
          {children ?? (
            <Link
              href="/auth/login"
              className="bg-indigo-600 text-white text-sm px-5 py-2 rounded-full hover:bg-indigo-500 transition-colors font-medium"
            >
              Start Free
            </Link>
          )}
        </div>
      </div>
    </nav>
  )
}
