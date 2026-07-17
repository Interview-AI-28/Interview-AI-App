// Single source of truth for round-type badge colors.
// Categorical palette: brand indigo is reserved for tech_l1; managerial uses
// sky (distinct from the retired blue brand accent).
export const ROUND_COLORS: Record<string, string> = {
  tech_l1: 'bg-indigo-50 text-indigo-600 border border-indigo-200',
  tech_l2: 'bg-violet-50 text-violet-600 border border-violet-200',
  managerial: 'bg-sky-50 text-sky-600 border border-sky-200',
  hr: 'bg-emerald-50 text-emerald-600 border border-emerald-200',
  full_loop: 'bg-orange-50 text-orange-600 border border-orange-200',
  drill: 'bg-gray-100 text-gray-600 border border-gray-200',
}

export const ROUND_COLOR_FALLBACK = 'bg-gray-100 text-gray-600 border border-gray-200'
