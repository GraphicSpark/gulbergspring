import { DATE_RANGES } from '../lib/filters'
import './RangeTabs.css'

// Flat underline tab filter, matching the BlackDrivo dashboard "All Time / Today /
// This Week / This Month" control. Deliberately NOT pill-shaped.
export default function RangeTabs({ options = DATE_RANGES, value, onChange, label }) {
  return (
    <div className="range-tabs" role="tablist">
      {label && <span className="range-tabs-label">{label}:</span>}
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          role="tab"
          aria-selected={value === opt.key}
          className={`range-tab${value === opt.key ? ' active' : ''}`}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
