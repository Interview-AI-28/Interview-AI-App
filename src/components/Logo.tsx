import Link from 'next/link'
import { Mic } from 'lucide-react'

export default function Logo({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5">
      <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
        <Mic className="w-3.5 h-3.5 text-white" />
      </div>
      <span className="font-bold text-lg text-gray-900 tracking-tight">Intervizly</span>
    </Link>
  )
}
