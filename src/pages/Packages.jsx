import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { History, PackageOpen, Pencil, Plus, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDateTime, fmtMoney } from '../lib/format'
import Modal from '../components/Modal'
import SearchSelect from '../components/SearchSelect'
import DataTable from '../components/data/DataTable'

const rateText = (kind, value) =>
  kind === 'percent' ? `${value}% of order` : `${fmtMoney(value)} (fixed)`

export default function Packages() {
  const { can } = useAuth()
  const canView = can('clients', 'view')
  const canEdit = can('clients', 'edit')

  const [clients, setClients] = useState([])
  const [clientId, setClientId] = useState('')
  const [packages, setPackages] = useState([])
  const [loading, setLoading] = useState(false)

  const [formPkg, setFormPkg] = useState(null) // pkg row | 'new' | null
  const [historyPkg, setHistoryPkg] = useState(null)

  useEffect(() => {
    supabase
      .from('clients')
      .select('id, ref_no, company_name')
      .order('company_name')
      .then(({ data }) => setClients(data ?? []))
  }, [])

  const loadPackages = useCallback(async (cid) => {
    if (!cid) {
      setPackages([])
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('client_packages')
      .select('*')
      .eq('client_id', cid)
      .order('is_active', { ascending: false })
      .order('name')
    if (error) toast.error('Could not load packages')
    setPackages(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadPackages(clientId)
  }, [clientId, loadPackages])

  const client = clients.find((c) => c.id === clientId) || null

  const toggleActive = async (p) => {
    const { error } = await supabase
      .from('client_packages')
      .update({ is_active: !p.is_active })
      .eq('id', p.id)
    if (error) return toast.error(error.message)
    toast.success(p.is_active ? 'Package deactivated' : 'Package activated')
    loadPackages(clientId)
  }

  const columns = useMemo(
    () => [
      { key: 'name', header: 'Package', render: (p) => <span className="primary">{p.name}</span> },
      { key: 'price', header: 'Price', render: (p) => fmtMoney(p.price) },
      { key: 'rate', header: 'Client gets', render: (p) => rateText(p.commission_kind, p.commission_value) },
      {
        key: 'active',
        header: 'Active',
        render: (p) =>
          canEdit ? (
            <select
              className="inline-select"
              value={p.is_active ? 'y' : 'n'}
              onChange={() => toggleActive(p)}
            >
              <option value="y">Active</option>
              <option value="n">Inactive</option>
            </select>
          ) : (
            <span className={`status-text ${p.is_active ? 'on' : 'off'}`}>
              {p.is_active ? 'Active' : 'Inactive'}
            </span>
          ),
      },
      {
        key: 'action',
        header: 'Action',
        align: 'right',
        render: (p) => (
          <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
            <button title="Change history" onClick={() => setHistoryPkg(p)}>
              <History size={13} />
            </button>
            {canEdit && (
              <button title="Edit" onClick={() => setFormPkg(p)}>
                <Pencil size={13} />
              </button>
            )}
          </div>
        ),
      },
    ],
    [canEdit], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <PackageOpen size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Packages.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Packages</h1>
          <p className="page-subtitle">Each client&rsquo;s service menu and its rates</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={() => loadPackages(clientId)} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canEdit && clientId && (
            <button className="btn" onClick={() => setFormPkg('new')}>
              <Plus size={15} /> Add package
            </button>
          )}
        </div>
      </div>

      <div className="field" style={{ maxWidth: 360 }}>
        <label>Client</label>
        <SearchSelect
          value={clientId}
          onChange={setClientId}
          placeholder="Pick a client…"
          options={clients.map((c) => ({ value: c.id, label: `#${c.ref_no} · ${c.company_name}` }))}
        />
      </div>

      {!clientId ? (
        <div className="card placeholder-card">
          <PackageOpen size={26} color="var(--muted)" />
          <p>Pick a client to see its packages.</p>
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={packages}
          rowKey={(p) => p.id}
          loading={loading}
          emptyLabel={`No packages for ${client?.company_name ?? 'this client'} yet — add one so orders can use it.`}
          title={client ? `${client.company_name} · packages` : 'Packages'}
          subtitle={`${packages.length}`}
        />
      )}

      {formPkg && (
        <PackageForm
          pkg={formPkg === 'new' ? null : formPkg}
          clientId={clientId}
          onClose={() => setFormPkg(null)}
          onDone={() => {
            setFormPkg(null)
            loadPackages(clientId)
          }}
        />
      )}

      {historyPkg && (
        <HistoryModal pkg={historyPkg} onClose={() => setHistoryPkg(null)} />
      )}
    </div>
  )
}

function PackageForm({ pkg, clientId, onClose, onDone }) {
  const editing = Boolean(pkg)
  const [name, setName] = useState(pkg?.name ?? '')
  const [price, setPrice] = useState(String(pkg?.price ?? ''))
  const [kind, setKind] = useState(pkg?.commission_kind ?? 'fixed')
  const [value, setValue] = useState(String(pkg?.commission_value ?? ''))
  const [active, setActive] = useState(pkg ? pkg.is_active : true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!name.trim()) return setErr('Package name is required')
    const pr = Number(price) || 0
    if (pr <= 0) return setErr('Enter the package price')
    const v = Number(value) || 0
    if (kind === 'percent' && v > 100) return setErr('Percent cannot exceed 100')

    setBusy(true)
    const payload = {
      name: name.trim(),
      price: pr,
      commission_kind: kind,
      commission_value: v,
      is_active: active,
    }
    const q = editing
      ? supabase.from('client_packages').update(payload).eq('id', pkg.id)
      : supabase.from('client_packages').insert({ ...payload, client_id: clientId })
    const { error } = await q
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(editing ? 'Package updated' : 'Package added')
    onDone()
  }

  return (
    <Modal open onClose={onClose} title={editing ? 'Edit package' : 'Add package'} width={460}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label htmlFor="pk-name">Package name *</label>
          <input
            id="pk-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Full Body Massage"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="pk-price">Package price (Rs) *</label>
          <input
            id="pk-price"
            className="input"
            type="number"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="10000"
          />
          <span className="field-hint">Auto-fills the order amount; the agent can apply a discount per order.</span>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pk-kind">Client&rsquo;s commission</label>
            <select id="pk-kind" className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="fixed">Fixed Rs per order</option>
              <option value="percent">% of order amount</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pk-val">{kind === 'percent' ? 'Percent' : 'Amount (Rs)'}</label>
            <input
              id="pk-val"
              className="input"
              type="number"
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={kind === 'percent' ? '40' : '5000'}
            />
          </div>
        </div>
        {editing && (
          <label className="check-line">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (available when creating orders)
          </label>
        )}
        {editing && (
          <p className="field-hint">
            Changing the rate is logged. Existing orders keep the rate they were created with.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add package'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function HistoryModal({ pkg, onClose }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    supabase
      .from('client_package_log')
      .select('*, changed_by:changed_by(full_name)')
      .eq('package_id', pkg.id)
      .order('changed_at', { ascending: false })
      .then(({ data }) => setRows(data ?? []))
  }, [pkg.id])

  return (
    <Modal open onClose={onClose} title={`History — ${pkg.name}`} width={480}>
      {rows === null ? (
        <p className="field-hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="field-hint">No rate changes yet. Current: {rateText(pkg.commission_kind, pkg.commission_value)}</p>
      ) : (
        <div className="branch-list">
          {rows.map((r) => (
            <div className="branch-item" key={r.id}>
              <div className="branch-item-main">
                <div className="branch-item-name">
                  {rateText(r.old_kind, r.old_value)} &rarr; {rateText(r.new_kind, r.new_value)}
                </div>
                <div className="branch-item-poc">
                  {fmtDateTime(r.changed_at)}
                  {r.changed_by?.full_name ? ` · ${r.changed_by.full_name}` : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
