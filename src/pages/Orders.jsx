import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BadgeCheck,
  ClipboardList,
  Clock,
  Eye,
  Plus,
  RefreshCw,
  Trash2,
  Wallet,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate, fmtMoney } from '../lib/format'
import { formatPkPhone, isValidPkMobile, pkPhoneError, toStored } from '../lib/phone'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import PkPhoneInput from '../components/PkPhoneInput'
import SearchSelect from '../components/SearchSelect'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import BulkBar from '../components/data/BulkBar'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

const ORDER_SELECT = `
  id, ref_no, service, package_id, package_name, amount, status, notes, created_at,
  list_amount, discount_kind, discount_value,
  client_kind, client_value, client_amount,
  agent_kind, agent_value, agent_amount, company_amount,
  confirmed_at,
  customer:customer_id ( ref_no, full_name, phone ),
  client:client_id ( ref_no, company_name ),
  branch:branch_id ( branch_name, city ),
  agent:agent_id ( full_name )
`

const statusClass = (s) => (s === 'confirmed' ? 'on' : s === 'cancelled' ? 'bad' : 'off')

// discount amount off a list price; final = max(list - discount, 0)
const calcDiscount = (list, kind, value) => {
  const l = Number(list) || 0
  const v = Number(value) || 0
  if (kind === 'percent') return Math.min(Math.round(l * v) / 100, l)
  if (kind === 'fixed') return Math.min(v, l)
  return 0
}
const finalAmount = (list, kind, value) => Math.max((Number(list) || 0) - calcDiscount(list, kind, value), 0)

function Row({ label, value }) {
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <span className="view-value">{value || '—'}</span>
    </div>
  )
}

export default function Orders() {
  const { can, profile } = useAuth()
  const canView = can('orders', 'view')
  const canAdd = can('orders', 'add')
  const canEdit = can('orders', 'edit')
  const canDelete = can('orders', 'delete')
  const canConfirm = can('orders', 'confirm')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState('all')
  const [clientF, setClientF] = useState('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [viewId, setViewId] = useState(null)
  const [del, setDel] = useState(null)
  const [delBusy, setDelBusy] = useState(false)

  // lookups for the add form / client filter
  const [clients, setClients] = useState([])

  const fetchRows = useCallback(async () => {
    const [{ data, error }, cl] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false }),
      supabase
        .from('clients')
        .select(
          'id, ref_no, company_name, client_branches(id, branch_name, city, is_primary), client_packages(id, name, price, commission_kind, commission_value, is_active)',
        )
        .order('company_name'),
    ])
    if (error) toast.error('Could not load orders')
    setRows(data ?? [])
    setClients(cl.data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const viewOrder = rows.find((o) => o.id === viewId) || null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((o) => {
      if (statusF !== 'all' && o.status !== statusF) return false
      if (clientF !== 'all' && o.client?.ref_no !== Number(clientF)) return false
      if (mineOnly && o.agent?.full_name !== profile?.full_name) return false
      if (from && o.created_at < from) return false
      if (to && o.created_at > `${to}T23:59:59`) return false
      if (q) {
        const hay = `${o.ref_no} ${o.customer?.full_name ?? ''} ${o.customer?.phone ?? ''} ${o.client?.company_name ?? ''} ${o.package_name ?? o.service ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, statusF, clientF, mineOnly, from, to, profile])

  const activeFilters =
    (statusF !== 'all' ? 1 : 0) + (clientF !== 'all' ? 1 : 0) + (mineOnly ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)

  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setStatusF('all')
    setClientF('all')
    setMineOnly(false)
    setFrom('')
    setTo('')
    setSearch('')
    setPage(1)
  }
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => {
    const mStart = new Date()
    mStart.setDate(1)
    mStart.setHours(0, 0, 0, 0)
    return {
      total: rows.length,
      pending: rows.filter((o) => o.status === 'pending').length,
      confirmed: rows.filter((o) => o.status === 'confirmed').length,
      net: rows
        .filter((o) => o.status === 'confirmed' && o.confirmed_at && new Date(o.confirmed_at) >= mStart)
        .reduce((s, o) => s + Number(o.company_amount || 0), 0),
    }
  }, [rows])

  const doDelete = async () => {
    if (!del) return
    setDelBusy(true)
    const ids = del.kind === 'bulk' ? [...del.ids] : [del.row.id]
    const { error } = await supabase.from('orders').delete().in('id', ids)
    setDelBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`${ids.length} order(s) deleted`)
    setDel(null)
    setBulkAction('')
    fetchRows()
  }

  const toggle = (id) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === pageRows.length ? new Set() : new Set(pageRows.map((o) => o.id)),
    )

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <ClipboardList size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Orders.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (o) => o.ref_no },
    {
      key: 'customer',
      header: 'Customer',
      render: (o) => (
        <div className="stack">
          <span className="primary">{o.customer?.full_name ?? '—'}</span>
          <span className="secondary">{o.customer?.ref_no}</span>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      render: (o) => (
        <div className="stack">
          <span className="primary">{o.client?.company_name ?? '—'}</span>
          {o.branch && <span className="secondary">{o.branch.branch_name} · {o.branch.city}</span>}
        </div>
      ),
    },
    { key: 'package', header: 'Package', render: (o) => o.package_name || o.service },
    { key: 'amount', header: 'Amount', render: (o) => fmtMoney(o.amount) },
    { key: 'agent', header: 'Agent', render: (o) => o.agent?.full_name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (o) => <span className={`status-text ${statusClass(o.status)}`}>{cap(o.status)}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (o) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button title="View" onClick={() => setViewId(o.id)}>
            <Eye size={13} />
          </button>
          {canDelete && (
            <button className="danger" title="Delete" onClick={() => setDel({ kind: 'one', row: o })}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="page-subtitle">{stats.total} order(s)</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canAdd && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Order
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 't', label: 'Total', value: stats.total, icon: ClipboardList },
          { key: 'p', label: 'Pending', value: stats.pending, icon: Clock },
          { key: 'c', label: 'Confirmed', value: stats.confirmed, icon: BadgeCheck },
          { key: 'n', label: 'Net this month', value: fmtMoney(stats.net), icon: Wallet },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          resetPage()
        }}
        searchPlaceholder="Search order #, customer or package..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <>
            <select className="filter-select" value={statusF} onChange={(e) => { setStatusF(e.target.value); resetPage() }}>
              <option value="all">Any status</option>
              <option value="pending">Pending</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select className="filter-select" value={clientF} onChange={(e) => { setClientF(e.target.value); resetPage() }}>
              <option value="all">Any client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.ref_no}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </>
        }
        advanced={
          <>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input id="f-from" type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); resetPage() }} />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input id="f-to" type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); resetPage() }} />
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <label className="check-line">
                <input type="checkbox" checked={mineOnly} onChange={(e) => { setMineOnly(e.target.checked); resetPage() }} />
                My orders only
              </label>
            </div>
          </>
        }
      />

      {canDelete && (
        <BulkBar
          count={selected.size}
          value={bulkAction}
          onValue={setBulkAction}
          onApply={() => selected.size && setDel({ kind: 'bulk', ids: selected })}
          onClear={() => setSelected(new Set())}
          busy={delBusy}
          actions={[{ value: 'delete', label: 'Delete selected' }]}
        />
      )}

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(o) => o.id}
        loading={loading}
        emptyLabel="No orders match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        title="Orders"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <AddOrderModal
          clients={clients}
          agentId={profile?.id}
          canAddCustomer={can('customers', 'add')}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            fetchRows()
          }}
        />
      )}

      {viewOrder && (
        <OrderDetailModal
          order={viewOrder}
          canEdit={canEdit}
          canConfirm={canConfirm}
          clients={clients}
          onClose={() => setViewId(null)}
          onChanged={fetchRows}
        />
      )}

      {del && (
        <ConfirmDelete
          open
          title={del.kind === 'bulk' ? 'Delete orders' : 'Delete order'}
          message={
            del.kind === 'bulk'
              ? `This permanently deletes ${del.ids.size} order(s).`
              : `This permanently deletes order ${del.row.ref_no}.`
          }
          busy={delBusy}
          onConfirm={doDelete}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  )
}

// ── Add order ─────────────────────────────────────────────────────────────
function AddOrderModal({ clients, agentId, canAddCustomer, onClose, onDone }) {
  const [customers, setCustomers] = useState([])
  const [f, setF] = useState({
    client_id: '',
    branch_id: '',
    package_id: '',
    customer_id: '',
    discount_kind: 'none',
    discount_value: '',
    notes: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  // inline "new customer" mini-form
  const [quick, setQuick] = useState(null) // null | { name, phoneLocal }
  const [qErr, setQErr] = useState('')
  const [qBusy, setQBusy] = useState(false)

  const addQuickCustomer = async () => {
    setQErr('')
    const name = quick.name.trim()
    if (!name) return setQErr('Customer name is required')
    if (!isValidPkMobile(quick.phoneLocal)) {
      return setQErr(pkPhoneError(quick.phoneLocal) || 'Enter a valid phone number')
    }
    const phone = toStored(quick.phoneLocal)

    setQBusy(true)
    // existing-customer check (phone is the natural key, not DB-enforced)
    const { data: dupe } = await supabase
      .from('customers')
      .select('id, ref_no, full_name, phone')
      .eq('phone', phone)
      .maybeSingle()
    if (dupe) {
      setQBusy(false)
      setCustomers((prev) => (prev.some((c) => c.id === dupe.id) ? prev : [...prev, dupe]))
      set('customer_id', dupe.id)
      setQuick(null)
      toast(`${dupe.full_name} already has this number — selected`)
      return
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({ full_name: name, phone, source: 'walk-in', created_by: agentId })
      .select('id, ref_no, full_name, phone')
      .single()
    setQBusy(false)
    if (error) return setQErr(error.message)
    setCustomers((prev) =>
      [...prev, data].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')),
    )
    set('customer_id', data.id)
    setQuick(null)
    toast.success('Customer added')
  }

  useEffect(() => {
    supabase
      .from('customers')
      .select('id, ref_no, full_name, phone')
      .order('full_name')
      .then(({ data }) => setCustomers(data ?? []))
  }, [])

  const selClient = clients.find((c) => c.id === f.client_id)
  const branches = selClient?.client_branches ?? []
  const pkgs = (selClient?.client_packages ?? []).filter((p) => p.is_active)
  const selPkg = pkgs.find((p) => p.id === f.package_id)
  const listAmt = Number(selPkg?.price) || 0
  const discAmt = calcDiscount(listAmt, f.discount_kind, f.discount_value)
  const payAmt = finalAmount(listAmt, f.discount_kind, f.discount_value)

  const pickClient = (v) => {
    const cl = clients.find((c) => c.id === v)
    const brs = cl?.client_branches ?? []
    setF((p) => ({ ...p, client_id: v, branch_id: brs.length === 1 ? brs[0].id : '', package_id: '' }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!f.client_id) return setErr('Pick a client')
    if (branches.length > 1 && !f.branch_id) return setErr('Pick a branch')
    if (!f.package_id) return setErr('Pick a package')
    if (!f.customer_id) return setErr('Pick a customer')
    if (f.discount_kind !== 'none') {
      const dv = Number(f.discount_value)
      if (!dv || dv <= 0) return setErr('Enter the discount')
      if (f.discount_kind === 'percent' && dv > 100) return setErr('Discount % cannot exceed 100')
      if (f.discount_kind === 'fixed' && dv > listAmt) return setErr('Discount cannot exceed the package price')
    }
    if (payAmt <= 0) return setErr('Amount after discount must be more than 0')

    setBusy(true)
    const { error } = await supabase.from('orders').insert({
      customer_id: f.customer_id,
      client_id: f.client_id,
      branch_id: f.branch_id || branches[0]?.id || null,
      package_id: f.package_id,
      agent_id: agentId,
      created_by: agentId,
      discount_kind: f.discount_kind,
      discount_value: f.discount_kind === 'none' ? 0 : Number(f.discount_value) || 0,
      notes: f.notes.trim() || null,
      status: 'pending',
    })
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Order created')
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="Add order" width={520}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        <div className="field">
          <label>Client *</label>
          <SearchSelect
            value={f.client_id}
            onChange={pickClient}
            placeholder="Pick a client…"
            options={clients.map((c) => ({ value: c.id, label: `${c.ref_no} · ${c.company_name}` }))}
          />
        </div>

        <div className="field">
          <label>Branch *</label>
          <SearchSelect
            value={f.branch_id}
            onChange={(v) => set('branch_id', v)}
            disabled={!f.client_id}
            placeholder={f.client_id ? 'Pick a branch…' : 'Pick a client first'}
            options={branches.map((b) => ({
              value: b.id,
              label: b.branch_name,
              sub: `${b.city || '—'}${b.is_primary ? ' · primary' : ''}`,
            }))}
          />
        </div>

        <div className="field">
          <label>Package *</label>
          <SearchSelect
            value={f.package_id}
            onChange={(v) => set('package_id', v)}
            disabled={!f.client_id}
            placeholder={
              !f.client_id
                ? 'Pick a client first'
                : pkgs.length
                  ? 'Pick a package…'
                  : 'This client has no active packages'
            }
            options={pkgs.map((p) => ({
              value: p.id,
              label: p.name,
              sub:
                p.commission_kind === 'percent'
                  ? `client gets ${p.commission_value}%`
                  : `client gets Rs ${Number(p.commission_value).toLocaleString('en-PK')}`,
            }))}
          />
          {f.client_id && pkgs.length === 0 && (
            <span className="field-hint">Add a package on the Packages page first.</span>
          )}
        </div>

        <div className="field">
          <label>Customer *</label>
          <div className="ss-row">
            <SearchSelect
              value={f.customer_id}
              onChange={(v) => set('customer_id', v)}
              placeholder="Search customer…"
              options={customers.map((c) => ({
                value: c.id,
                label: `${c.ref_no} · ${c.full_name}`,
                sub: c.phone ? formatPkPhone(c.phone) : '',
              }))}
            />
            {canAddCustomer && (
              <button
                type="button"
                className="icon-btn"
                title="New customer"
                onClick={() =>
                  setQuick((q) => (q ? null : { name: '', phoneLocal: '' }))
                }
              >
                <Plus size={16} />
              </button>
            )}
          </div>

          {quick && (
            <div className="quick-add">
              <div className="field-row">
                <div className="field">
                  <label>Customer name</label>
                  <input
                    className="input"
                    autoFocus
                    value={quick.name}
                    onChange={(e) => setQuick((q) => ({ ...q, name: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addQuickCustomer()
                      }
                    }}
                  />
                </div>
                <div className="field">
                  <label>Phone number</label>
                  <PkPhoneInput
                    value={quick.phoneLocal}
                    onChange={(v) => setQuick((q) => ({ ...q, phoneLocal: v }))}
                    invalid={Boolean(quick.phoneLocal) && !isValidPkMobile(quick.phoneLocal)}
                  />
                </div>
              </div>
              {qErr && <span className="field-error">{qErr}</span>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost btn-square" onClick={() => setQuick(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-square"
                  onClick={addQuickCustomer}
                  disabled={qBusy}
                >
                  {qBusy ? 'Adding…' : 'Add customer'}
                </button>
              </div>
            </div>
          )}
        </div>

        {f.package_id && (
          <div className="split-box">
            <div className="split-row"><span>Package price</span><b>{fmtMoney(listAmt)}</b></div>
            <div className="field-row" style={{ marginTop: 8 }}>
              <div className="field">
                <label>Discount</label>
                <select
                  className="select"
                  value={f.discount_kind}
                  onChange={(e) => set('discount_kind', e.target.value)}
                >
                  <option value="none">No discount</option>
                  <option value="fixed">Fixed Rs off</option>
                  <option value="percent">% off</option>
                </select>
              </div>
              {f.discount_kind !== 'none' && (
                <div className="field">
                  <label>{f.discount_kind === 'percent' ? 'Percent off' : 'Rs off'}</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={f.discount_value}
                    onChange={(e) => set('discount_value', e.target.value)}
                    placeholder={f.discount_kind === 'percent' ? '10' : '1000'}
                  />
                </div>
              )}
            </div>
            {discAmt > 0 && (
              <div className="split-row"><span>Discount</span><b>− {fmtMoney(discAmt)}</b></div>
            )}
            <div className="split-row total"><span>Customer pays</span><b>{fmtMoney(payAmt)}</b></div>
          </div>
        )}

        <div className="field">
          <label htmlFor="o-notes">Notes (optional)</label>
          <textarea id="o-notes" className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>

        <p className="field-hint">You will be recorded as the agent for this order.</p>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : 'Create order'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Order detail / confirm / edit ─────────────────────────────────────────
function OrderDetailModal({ order, canEdit, canConfirm, clients, onClose, onChanged }) {
  const [mode, setMode] = useState('view') // view | edit
  const [busy, setBusy] = useState(false)

  const isPending = order.status === 'pending'

  const confirm = async () => {
    if (!window.confirm('Confirm that the customer availed this service? This cannot be undone.')) return
    setBusy(true)
    const { error } = await supabase.rpc('confirm_order', { p_order_id: order.id })
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`Order ${order.ref_no} confirmed`)
    onChanged()
  }

  const cancel = async () => {
    if (!window.confirm('Cancel this order?')) return
    setBusy(true)
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Order cancelled')
    onChanged()
  }

  if (mode === 'edit') {
    return (
      <EditOrderModal
        order={order}
        clients={clients}
        onCancel={() => setMode('view')}
        onDone={() => {
          setMode('view')
          onChanged()
        }}
      />
    )
  }

  return (
    <Modal open onClose={onClose} title={`Order ${order.ref_no}`} width={480}>
      <div>
        <Row label="Status" value={<span className={`status-text ${statusClass(order.status)}`}>{cap(order.status)}</span>} />
        <Row label="Customer" value={`${order.customer?.ref_no} · ${order.customer?.full_name ?? '—'}`} />
        <Row label="Client" value={`${order.client?.ref_no} · ${order.client?.company_name ?? '—'}`} />
        <Row label="Branch" value={order.branch ? `${order.branch.branch_name} · ${order.branch.city}` : '—'} />
        <Row label="Package" value={order.package_name || order.service} />
        {order.list_amount != null && order.discount_kind && order.discount_kind !== 'none' ? (
          <>
            <Row label="Package price" value={fmtMoney(order.list_amount)} />
            <Row
              label="Discount"
              value={
                order.discount_kind === 'percent'
                  ? `${order.discount_value}%  (− ${fmtMoney(Number(order.list_amount) - Number(order.amount))})`
                  : `${fmtMoney(order.discount_value)} off`
              }
            />
            <Row label="Customer pays" value={fmtMoney(order.amount)} />
          </>
        ) : (
          <Row label="Amount" value={fmtMoney(order.amount)} />
        )}
        <Row label="Agent" value={order.agent?.full_name} />
        <Row label="Notes" value={order.notes} />
        <Row label="Created" value={fmtDate(order.created_at)} />
        {order.status === 'confirmed' && (
          <Row label="Confirmed" value={fmtDate(order.confirmed_at)} />
        )}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
          Close
        </button>
        {isPending && canEdit && (
          <>
            <button type="button" className="btn btn-ghost btn-square" onClick={cancel} disabled={busy}>
              Cancel order
            </button>
            <button type="button" className="btn btn-ghost btn-square" onClick={() => setMode('edit')}>
              Edit
            </button>
          </>
        )}
        {isPending && canConfirm && (
          <button type="button" className="btn btn-square" onClick={confirm} disabled={busy}>
            <BadgeCheck size={14} /> {busy ? 'Confirming…' : 'Confirm — service availed'}
          </button>
        )}
      </div>
    </Modal>
  )
}

function EditOrderModal({ order, clients, onCancel, onDone }) {
  const [customers, setCustomers] = useState([])
  const [f, setF] = useState(() => {
    const cl = order.client?.ref_no ? clients.find((c) => c.ref_no === order.client.ref_no) : null
    const brs = cl?.client_branches ?? []
    const br =
      brs.find((b) => b.branch_name === order.branch?.branch_name) ||
      brs.find((b) => b.is_primary) ||
      brs[0]
    return {
      client_id: cl?.id ?? '',
      branch_id: br?.id ?? '',
      customer_id: '',
      package_id: order.package_id ?? '',
      discount_kind: order.discount_kind ?? 'none',
      discount_value: order.discount_value ? String(order.discount_value) : '',
      notes: order.notes ?? '',
    }
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    supabase
      .from('customers')
      .select('id, ref_no, full_name, phone')
      .order('full_name')
      .then(({ data }) => {
        setCustomers(data ?? [])
        const match = (data ?? []).find((c) => c.ref_no === order.customer?.ref_no)
        if (match) setF((p) => ({ ...p, customer_id: match.id }))
      })
  }, [order.customer?.ref_no])

  const selClient = clients.find((c) => c.id === f.client_id)
  const branches = selClient?.client_branches ?? []
  const pkgs = (() => {
    const list = (selClient?.client_packages ?? []).filter((p) => p.is_active)
    // keep the order's current package selectable even if since deactivated
    if (
      f.package_id &&
      order.package_id === f.package_id &&
      !list.some((p) => p.id === f.package_id)
    ) {
      const cur = (selClient?.client_packages ?? []).find((p) => p.id === f.package_id)
      if (cur) list.push(cur)
    }
    return list
  })()
  const selPkg = pkgs.find((p) => p.id === f.package_id)
  const listAmt = Number(selPkg?.price) || Number(order.list_amount) || 0
  const discAmt = calcDiscount(listAmt, f.discount_kind, f.discount_value)
  const payAmt = finalAmount(listAmt, f.discount_kind, f.discount_value)

  const pickClient = (v) => {
    const brs = clients.find((c) => c.id === v)?.client_branches ?? []
    const cur = brs.find((b) => b.branch_name === order.branch?.branch_name)
    setF((p) => ({
      ...p,
      client_id: v,
      branch_id: cur?.id || brs.find((b) => b.is_primary)?.id || brs[0]?.id || '',
      package_id: v === p.client_id ? p.package_id : '',
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!f.client_id || !f.branch_id || !f.customer_id) return setErr('Client, branch and customer are required')
    if (!f.package_id) return setErr('Pick a package')
    if (f.discount_kind !== 'none') {
      const dv = Number(f.discount_value)
      if (!dv || dv <= 0) return setErr('Enter the discount')
      if (f.discount_kind === 'percent' && dv > 100) return setErr('Discount % cannot exceed 100')
      if (f.discount_kind === 'fixed' && dv > listAmt) return setErr('Discount cannot exceed the package price')
    }
    if (payAmt <= 0) return setErr('Amount after discount must be more than 0')

    setBusy(true)
    const { error } = await supabase
      .from('orders')
      .update({
        client_id: f.client_id,
        branch_id: f.branch_id,
        customer_id: f.customer_id,
        package_id: f.package_id,
        discount_kind: f.discount_kind,
        discount_value: f.discount_kind === 'none' ? 0 : Number(f.discount_value) || 0,
        notes: f.notes.trim() || null,
      })
      .eq('id', order.id)
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success('Order updated')
    onDone()
  }

  return (
    <Modal open onClose={onCancel} title={`Edit order ${order.ref_no}`} width={520}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label>Client *</label>
          <SearchSelect
            value={f.client_id}
            onChange={pickClient}
            options={clients.map((c) => ({ value: c.id, label: `${c.ref_no} · ${c.company_name}` }))}
          />
        </div>
        <div className="field">
          <label>Branch *</label>
          <SearchSelect
            value={f.branch_id}
            onChange={(v) => set('branch_id', v)}
            disabled={!f.client_id}
            options={branches.map((b) => ({ value: b.id, label: b.branch_name, sub: b.city || '—' }))}
          />
        </div>
        <div className="field">
          <label>Customer *</label>
          <SearchSelect
            value={f.customer_id}
            onChange={(v) => set('customer_id', v)}
            options={customers.map((c) => ({
              value: c.id,
              label: `${c.ref_no} · ${c.full_name}`,
              sub: c.phone ? formatPkPhone(c.phone) : '',
            }))}
          />
        </div>
        <div className="field">
          <label>Package *</label>
          <SearchSelect
            value={f.package_id}
            onChange={(v) => set('package_id', v)}
            disabled={!f.client_id}
            placeholder={
              !f.client_id
                ? 'Pick a client first'
                : pkgs.length
                  ? 'Pick a package…'
                  : 'This client has no active packages'
            }
            options={pkgs.map((p) => ({
              value: p.id,
              label: p.name,
              sub:
                p.commission_kind === 'percent'
                  ? `client gets ${p.commission_value}%`
                  : `client gets Rs ${Number(p.commission_value).toLocaleString('en-PK')}`,
            }))}
          />
          <span className="field-hint">
            Changing the package re-applies its current price and rate. Confirmed orders are never affected.
          </span>
        </div>
        {f.package_id && (
          <div className="split-box">
            <div className="split-row"><span>Package price</span><b>{fmtMoney(listAmt)}</b></div>
            <div className="field-row" style={{ marginTop: 8 }}>
              <div className="field">
                <label>Discount</label>
                <select className="select" value={f.discount_kind} onChange={(e) => set('discount_kind', e.target.value)}>
                  <option value="none">No discount</option>
                  <option value="fixed">Fixed Rs off</option>
                  <option value="percent">% off</option>
                </select>
              </div>
              {f.discount_kind !== 'none' && (
                <div className="field">
                  <label>{f.discount_kind === 'percent' ? 'Percent off' : 'Rs off'}</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    value={f.discount_value}
                    onChange={(e) => set('discount_value', e.target.value)}
                  />
                </div>
              )}
            </div>
            {discAmt > 0 && (
              <div className="split-row"><span>Discount</span><b>− {fmtMoney(discAmt)}</b></div>
            )}
            <div className="split-row total"><span>Customer pays</span><b>{fmtMoney(payAmt)}</b></div>
          </div>
        )}
        <div className="field">
          <label>Notes (optional)</label>
          <textarea className="textarea" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
