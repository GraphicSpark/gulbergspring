import { formatPkPhone } from '../lib/phone'

// A stored phone (+923XXXXXXXXX) shown formatted, tap-to-call on click.
export default function PhoneLink({ phone }) {
  if (!phone) return '—'
  return (
    <a className="phone-link" href={`tel:${phone}`} onClick={(e) => e.stopPropagation()}>
      {formatPkPhone(phone)}
    </a>
  )
}
