import { useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { dbErrorMessage } from '../lib/errors'
import { fmtMoney } from '../lib/format'
import Modal from './Modal'
import SearchSelect from './SearchSelect'

// Records into `payouts`. party 'client' = money IN, 'agent' = money OUT.
//   row     - an existing payout to edit
//   preset  - { party, partyId, partyName, amount } to seed a NEW settlement
//   locked  - party + who are fixed (opened from a ledger row)
export default function SettlementModal({
  row,
  preset,
  locked = false,
  clients = [],
  agents = [],
  createdBy,
  onClose,
  onDone,
}) {
  const editing = Boolean(row)
  const [f, setF] = useState(() => {
    if (row) {
      return {
        party: row.party,
        client_id: row.client_id ?? '',
        agent_id: row.agent_id ?? '',
        amount: String(row.amount),
        paid_on: row.paid_on ?? new Date().toISOString().slice(0, 10),
        method: row.method ?? '',
        note: row.note ?? '',
      }
    }
    return {
      party: preset?.party ?? 'client',
      client_id: preset?.party === 'client' ? preset.partyId ?? '' : '',
      agent_id: preset?.party === 'agent' ? preset.partyId ?? '' : '',
      amount: preset?.amount != null ? String(Math.max(Math.round(preset.amount), 0)) : '',
      paid_on: new Date().toISOString().slice(0, 10),
      method: '',
      note: '',
    }
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const amt = Number(f.amount)
    if (!amt || amt <= 0) return setErr('Enter a valid amount')
    if (f.party === 'client' && !f.client_id) return setErr('Pick the client')
    if (f.party === 'agent' && !f.agent_id) return setErr('Pick the agent')
    if (!f.paid_on) return setErr('Pick the date')

    setBusy(true)
    const payload = {
      party: f.party,
      client_id: f.party === 'client' ? f.client_id : null,
      agent_id: f.party === 'agent' ? f.agent_id : null,
      amount: amt,
      paid_on: f.paid_on,
      method: f.method.trim() || null,
      note: f.note.trim() || null,
    }
    const q = editing
      ? supabase.from('payouts').update(payload).eq('id', row.id)
      : supabase.from('payouts').insert({ ...payload, created_by: createdBy })
    const { error } = await q
    setBusy(false)
    if (error) return setErr(dbErrorMessage(error, 'settlement'))
    toast.success(editing ? 'Settlement updated' : 'Settlement recorded')
    onDone()
  }

  const title = editing
    ? 'Edit settlement'
    : locked
      ? `Settle with ${preset?.partyName ?? (f.party === 'client' ? 'client' : 'agent')}`
      : 'Record settlement'

  return (
    <Modal open onClose={onClose} title={title} width={460}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        {locked ? (
          <div className="field">
            <label>{f.party === 'client' ? 'Received from client' : 'Paid to agent'}</label>
            <input className="input" value={preset?.partyName ?? ''} disabled />
          </div>
        ) : (
          <>
            <div className="field">
              <label>Type *</label>
              <select className="select" value={f.party} onChange={(e) => set('party', e.target.value)}>
                <option value="client">Received from a client (money in)</option>
                <option value="agent">Paid to an agent (money out)</option>
              </select>
            </div>
            {f.party === 'client' ? (
              <div className="field">
                <label>Client *</label>
                <SearchSelect
                  value={f.client_id}
                  onChange={(v) => set('client_id', v)}
                  placeholder="Pick a client…"
                  options={clients.map((c) => ({ value: c.id, label: `${c.ref_no} · ${c.company_name}` }))}
                />
              </div>
            ) : (
              <div className="field">
                <label>Agent *</label>
                <SearchSelect
                  value={f.agent_id}
                  onChange={(v) => set('agent_id', v)}
                  placeholder="Pick an agent…"
                  options={agents.map((a) => ({ value: a.id, label: a.full_name }))}
                />
              </div>
            )}
          </>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="p-amt">Amount (Rs) *</label>
            <input id="p-amt" className="input" type="number" min="0" value={f.amount} onChange={(e) => set('amount', e.target.value)} />
            {locked && preset?.amount != null && (
              <span className="field-hint">Outstanding: {fmtMoney(preset.amount)}</span>
            )}
          </div>
          <div className="field">
            <label htmlFor="p-date">Date *</label>
            <input id="p-date" className="input" type="date" value={f.paid_on} onChange={(e) => set('paid_on', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="p-method">Method (optional)</label>
          <input id="p-method" className="input" value={f.method} onChange={(e) => set('method', e.target.value)} placeholder="Bank transfer, cash…" autoComplete="off" />
        </div>

        <div className="field">
          <label htmlFor="p-note">Note (optional)</label>
          <textarea id="p-note" className="textarea" value={f.note} onChange={(e) => set('note', e.target.value)} />
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Record settlement'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
