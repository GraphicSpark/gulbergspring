import { useRef } from 'react'
import { List } from 'lucide-react'
import './bullet-textarea.css'

const BULLET = '• '

// A textarea with a "Bullet" button. The button inserts "• " at the cursor
// (on its own line); pressing Enter on a bullet line continues the list, and
// Enter on an empty bullet line exits it.
export default function BulletTextarea({ id, value, onChange, placeholder, rows = 4 }) {
  const ref = useRef(null)

  const addBullet = () => {
    const ta = ref.current
    const start = ta ? ta.selectionStart : value.length
    const end = ta ? ta.selectionEnd : value.length
    const before = value.slice(0, start)
    const after = value.slice(end)
    const nl = before.length && !before.endsWith('\n') ? '\n' : ''
    const ins = nl + BULLET
    onChange(before + ins + after)
    requestAnimationFrame(() => {
      if (!ta) return
      ta.focus()
      const pos = start + ins.length
      ta.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Enter') return
    const ta = e.target
    const start = ta.selectionStart
    const v = ta.value
    const lineStart = v.lastIndexOf('\n', start - 1) + 1
    const line = v.slice(lineStart, start)
    if (!line.startsWith(BULLET)) return
    e.preventDefault()
    if (line.trim() === BULLET.trim()) {
      // empty bullet -> drop it and leave the list
      const next = v.slice(0, lineStart) + v.slice(start)
      onChange(next)
      requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart))
      return
    }
    const ins = '\n' + BULLET
    const next = v.slice(0, start) + ins + v.slice(ta.selectionEnd)
    onChange(next)
    requestAnimationFrame(() => {
      const pos = start + ins.length
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="bullet-ta">
      <div className="bullet-ta-bar">
        <button type="button" className="bullet-ta-btn" onClick={addBullet}>
          <List size={12} /> Bullet
        </button>
      </div>
      <textarea
        id={id}
        ref={ref}
        className="textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}
