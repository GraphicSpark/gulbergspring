import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { TIME_SLOT_GROUPS, slotLabel } from '../lib/slots'
import './time-slot-picker.css'

// Opens a floating panel (like the date picker) with grouped 15-min slots,
// instead of a plain <select> dropdown.
export default function TimeSlotPicker({ value, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (v) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div className={`tsp${disabled ? ' disabled' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="tsp-trigger"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={value ? 'tsp-value' : 'tsp-placeholder'}>
          {value ? slotLabel(value) : 'Any time'}
        </span>
        <Clock size={15} />
      </button>

      {open && (
        <div className="tsp-menu">
          <button type="button" className={`tsp-any${value ? '' : ' on'}`} onClick={() => pick('')}>
            Any time
          </button>
          {TIME_SLOT_GROUPS.map((g) => (
            <div className="tsp-group" key={g.label}>
              <div className="tsp-group-label">{g.label}</div>
              <div className="tsp-slots">
                {g.options.map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    className={`tsp-slot${o.value === value ? ' on' : ''}`}
                    onClick={() => pick(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
