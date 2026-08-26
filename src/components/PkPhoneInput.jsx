import { toLocal } from '../lib/phone'
import './pk-phone.css'

// Fixed +92 prefix; the user types the 10-digit local part (must start with 3).
// `value` / `onChange` deal in the 10-digit local string.
export default function PkPhoneInput({ id, value, onChange, invalid }) {
  return (
    <div className={`pk-phone${invalid ? ' invalid' : ''}`}>
      <span className="pk-phone-cc">+92</span>
      <input
        id={id}
        className="pk-phone-input"
        type="tel"
        inputMode="numeric"
        autoComplete="off"
        placeholder="345 1234567"
        value={value}
        onChange={(e) => onChange(toLocal(e.target.value))}
        maxLength={10}
      />
    </div>
  )
}
