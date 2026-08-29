// 30-minute booking time slots, grouped by part of the day.
// Stored on orders.scheduled_time as a `time` value ("12:30:00");
// the picker works in "HH:MM" and shows a 12-hour label ("12:30 PM").

const GROUPS = [
  { label: 'Late Night', from: 0, to: 4 }, // 00:00 – 04:45
  { label: 'Early Morning', from: 5, to: 8 }, // 05:00 – 08:45
  { label: 'Morning', from: 9, to: 11 }, // 09:00 – 11:45
  { label: 'Noon', from: 12, to: 12 }, // 12:00 – 12:45
  { label: 'Afternoon', from: 13, to: 16 }, // 01:00 – 04:45 PM
  { label: 'Evening', from: 17, to: 20 }, // 05:00 – 08:45 PM
  { label: 'Night', from: 21, to: 23 }, // 09:00 – 11:45 PM
]

const pad = (n) => String(n).padStart(2, '0')

const to12h = (h, m) => {
  const ap = h < 12 ? 'AM' : 'PM'
  const hh = h % 12 === 0 ? 12 : h % 12
  return `${hh}:${pad(m)} ${ap}`
}

export const TIME_SLOT_GROUPS = GROUPS.map((g) => {
  const options = []
  for (let h = g.from; h <= g.to; h++) {
    for (const m of [0, 30]) {
      options.push({ value: `${pad(h)}:${pad(m)}`, label: to12h(h, m) })
    }
  }
  return { label: g.label, options }
})

const ALL = TIME_SLOT_GROUPS.flatMap((g) => g.options)

// normalise a stored "HH:MM[:SS]" to the "HH:MM" the select uses
export const toSlotValue = (t) => (t ? String(t).slice(0, 5) : '')

// "12:15 PM" for a stored/selected time; falls back to the raw value
export const slotLabel = (t) => {
  const key = toSlotValue(t)
  if (!key) return ''
  return ALL.find((o) => o.value === key)?.label || key
}
