// Small CSV helpers - enough for name/phone/email style imports & exports.
// Handles quoted fields, escaped quotes ("") and \r\n / \n line endings.

export function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

// rows: array of objects; headers: array of { key, label }
export function toCsv(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /["\n,\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.map((h) => esc(h.label)).join(',')]
  for (const r of rows) lines.push(headers.map((h) => esc(r[h.key])).join(','))
  return lines.join('\r\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
