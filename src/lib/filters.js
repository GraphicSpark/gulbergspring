// Shared filter option sets. Kept out of the component file so the component
// module only exports a component (React Fast Refresh).

export const DATE_RANGES = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]

const pad2 = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

// lower-bound date ('YYYY-MM-DD', local) for a range key; '' = no bound ('all').
// Plugs straight into the ledgers' existing  `if (from && d < from)`  check.
export function rangeFrom(key) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (key === 'today') {
    // d is already start of today
  } else if (key === 'week') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Monday start
  } else if (key === 'month') {
    d.setDate(1)
  } else {
    return ''
  }
  return ymd(d)
}

// ── dashboard ranges (presets + custom) ─────────────────────────────────
export const DASH_RANGES = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'custom', label: 'Custom' },
]

// { from, to } as 'YYYY-MM-DD' (inclusive `from`, `to` = today unless custom).
// '' from  ->  unbounded.  `custom` uses the passed {from,to}.
export function rangeWindow(key, custom) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const today = ymd(now)

  if (key === 'custom') {
    return { from: custom?.from || '', to: custom?.to || today }
  }
  if (key === 'all') return { from: '', to: today }

  const s = new Date(now)
  if (key === 'today') {
    // s = start of today
  } else if (key === 'week') {
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7)) // Monday start
  } else if (key === 'month') {
    s.setDate(1)
  }
  return { from: ymd(s), to: today }
}
