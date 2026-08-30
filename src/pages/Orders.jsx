import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BadgeCheck,
  ClipboardList,
  Clock,
  Coins,
  Download,
  Eye,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Wallet,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate, fmtDateTime, fmtMoney } from '../lib/format'
import { formatPkPhone, isValidPkMobile, pkPhoneError, toStored } from '../lib/phone'
import { slotLabel, toSlotValue } from '../lib/slots'
import { packageSummary } from '../lib/ledger'
import { downloadCsv, toCsv } from '../lib/csv'
import TimeSlotPicker from '../components/TimeSlotPicker'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import ConfirmDialog from '../components/ConfirmDialog'
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
  id, ref_no, service, account_id, package_id, package_name, amount, status, notes, created_at,
  scheduled_date, scheduled_time,
  list_amount, discount_kind, discount_value,
  client_kind, client_value, client_amount,
  agent_kind, agent_value, agent_amount, company_amount,
  confirmed_at,
  order_items ( id, package_id, package_name, unit_price, qty, line_total, client_kind, client_value ),
  customer:customer_id ( ref_no, full_name, phone ),
  client:client_id ( ref_no, company_name ),
  branch:branch_id ( branch_name, city ),
  agent:agent_id ( full_name ),
  account:account_id ( ref_no, name )
`

const statusClass = (s) => (s === 'confirmed' ? 'on' : s === 'cancelled' ? 'bad' : 'off')

const discountText = (o) => {
  if (!o.discount_kind || o.discount_kind === 'none') return ''
  return o.discount_kind === 'percent'
    ? `${o.discount_value}% off`
    : `${fmtMoney(o.discount_value)} off`
}

// discount amount off a list price; final = max(list - discount, 0)
const calcDiscount = (list, kind, value) => {
  const l = Number(list) || 0
  const v = Number(value) || 0
  if (kind === 'percent') return Math.min(Math.round(l * v) / 100, l)
  if (kind === 'fixed') return Math.min(v, l)
  return 0
}
const finalAmount = (list, kind, value) => Math.max((Number(list) || 0) - calcDiscount(list, kind, value), 0)

// optional booking date + 15-min time slot
function WhenFields({ date, time, onDate, onTime }) {
  return (
    <div className="field-row">
      <div className="field">
        <label>Date (optional)</label>
        <input className="input" type="date" value={date} onChange={(e) => onDate(e.target.value)} />
      </div>
      <div className="field">
        <label>Time slot (optional)</label>
        <TimeSlotPicker value={time} onChange={onTime} />
      </div>
    </div>
  )
}

// running subtotal of a POS line list
const linesTotal = (lines) =>
  lines.reduce((s, l) => s + (Number(l.unit_price) || 0) * (Number(l.qty) || 1), 0)

// POS-style package picker: pick a package -> it drops straight into the cart
// below, each line with a qty stepper.
function PackageLines({ lines, onChange, packages, disabled, emptyHint }) {
  const used = new Set(lines.map((l) => l.package_id))
  const available = packages.filter((p) => !used.has(p.id))

  const addPackage = (id) => {
    const p = packages.find((x) => x.id === id)
    if (!p) return
    onChange([
      ...lines,
      {
        package_id: p.id,
        package_name: p.name,
        unit_price: Number(p.price) || 0,
        client_kind: p.commission_kind,
        client_value: p.commission_value,
        qty: 1,
      },
    ])
  }
  const setQty = (i, q) =>
    onChange(lines.map((l, idx) => (idx === i ? { ...l, qty: Math.max(1, q) } : l)))
  const remove = (i) => onChange(lines.filter((_, idx) => idx !== i))

  return (
    <div className="pos-lines">
      <SearchSelect
        value=""
        onChange={addPackage}
        disabled={disabled || available.length === 0}
        placeholder={
          disabled
            ? 'Pick a client first'
            : available.length === 0
              ? lines.length
                ? 'All packages added'
                : emptyHint || 'No active packages'
              : 'Pick a package to add…'
        }
        options={available.map((p) => ({
          value: p.id,
          label: p.name,
          sub:
            `${fmtMoney(p.price)} · ` +
            (p.commission_kind === 'percent'
              ? `client ${p.commission_value}%`
              : `client Rs ${Number(p.commission_value).toLocaleString('en-PK')}`),
        }))}
      />

      {lines.length > 0 && (
        <div className="pos-line-list">
          {lines.map((l, i) => (
            <div className="pos-line" key={l.package_id}>
              <span className="pos-line-name">{l.package_name}</span>
              <span className="pos-line-price">{fmtMoney(l.unit_price)}</span>
              <div className="pos-qty">
                <button type="button" onClick={() => setQty(i, l.qty - 1)} aria-label="Less">−</button>
                <input
                  type="number"
                  min="1"
                  value={l.qty}
                  onChange={(e) => setQty(i, parseInt(e.target.value, 10) || 1)}
                />
                <button type="button" onClick={() => setQty(i, l.qty + 1)} aria-label="More">+</button>
              </div>
              <span className="pos-line-total">{fmtMoney((Number(l.unit_price) || 0) * l.qty)}</span>
              <button type="button" className="pos-line-x" onClick={() => remove(i)} aria-label="Remove">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

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
  const [accountF, setAccountF] = useState('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [from, setFrom] = useState('') // created date
  const [to, setTo] = useState('')
  const [apptFrom, setApptFrom] = useState('') // appointment date
  const [apptTo, setApptTo] = useState('')
  const [apptTimeFrom, setApptTimeFrom] = useState('') // appointment time slot
  const [apptTimeTo, setApptTimeTo] = useState('')

  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [viewId, setViewId] = useState(null)
  const [del, setDel] = useState(null)
  const [delBusy, setDelBusy] = useState(false)

  // lookups for the add form / filters
  const [clients, setClients] = useState([])
  const [accounts, setAccounts] = useState([])

  const fetchRows = useCallback(async () => {
    const [{ data, error }, cl, ac] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT).order('created_at', { ascending: false }),
      supabase
        .from('clients')
        .select(
          'id, ref_no, company_name, client_branches(id, branch_name, city, is_primary), client_packages(id, name, price, commission_kind, commission_value, is_active)',
        )
        .order('company_name'),
      supabase.from('accounts').select('id, ref_no, name').order('name'),
    ])
    if (error) toast.error('Could not load orders')
    setRows(data ?? [])
    setClients(cl.data ?? [])
    setAccounts(ac.data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const viewOrder = rows.find((o) => o.id === viewId) || null

  const [toConfirm, setToConfirm] = useState(null) // order awaiting the confirm popup
  const [confirmBusy, setConfirmBusy] = useState(false)
  const doConfirm = async () => {
    if (!toConfirm) return
    setConfirmBusy(true)
    const { error } = await supabase.rpc('confirm_order', { p_order_id: toConfirm.id })
    setConfirmBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`Order ${toConfirm.ref_no} confirmed`)
    setToConfirm(null)
    fetchRows()
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((o) => {
      if (statusF !== 'all' && o.status !== statusF) return false
      if (clientF !== 'all' && o.client?.ref_no !== Number(clientF)) return false
      if (accountF !== 'all' && o.account?.ref_no !== Number(accountF)) return false
      if (mineOnly && o.agent?.full_name !== profile?.full_name) return false
      if (from && o.created_at < from) return false
      if (to && o.created_at > `${to}T23:59:59`) return false
      if (apptFrom && (!o.scheduled_date || o.scheduled_date < apptFrom)) return false
      if (apptTo && (!o.scheduled_date || o.scheduled_date > apptTo)) return false
      if (apptTimeFrom && (!o.scheduled_time || toSlotValue(o.scheduled_time) < apptTimeFrom)) return false
      if (apptTimeTo && (!o.scheduled_time || toSlotValue(o.scheduled_time) > apptTimeTo)) return false
      if (q) {
        const hay = `${o.ref_no} ${o.customer?.full_name ?? ''} ${o.customer?.phone ?? ''} ${o.client?.company_name ?? ''} ${packageSummary(o)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, statusF, clientF, accountF, mineOnly, from, to, apptFrom, apptTo, apptTimeFrom, apptTimeTo, profile])

  const activeFilters =
    (statusF !== 'all' ? 1 : 0) +
    (clientF !== 'all' ? 1 : 0) +
    (accountF !== 'all' ? 1 : 0) +
    (mineOnly ? 1 : 0) +
    (from ? 1 : 0) +
    (to ? 1 : 0) +
    (apptFrom ? 1 : 0) +
    (apptTo ? 1 : 0) +
    (apptTimeFrom ? 1 : 0) +
    (apptTimeTo ? 1 : 0)

  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setStatusF('all')
    setClientF('all')
    setAccountF('all')
    setMineOnly(false)
    setFrom('')
    setTo('')
    setApptFrom('')
    setApptTo('')
    setApptTimeFrom('')
    setApptTimeTo('')
    setSearch('')
    setPage(1)
  }
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => {
    // over confirmed orders (realised revenue):
    //   Sales    = list price, before discount   (Σ list_amount)
    //   Discount = Sales − Gross                  (Σ list_amount − Σ amount)
    //   Gross    = what the customer pays, after discount (Σ amount)
    const done = rows.filter((o) => o.status === 'confirmed')
    const sales = done.reduce((s, o) => s + Number(o.list_amount ?? o.amount ?? 0), 0)
    const gross = done.reduce((s, o) => s + Number(o.amount ?? 0), 0)
    return {
      total: rows.length,
      pending: rows.filter((o) => o.status === 'pending').length,
      confirmed: done.length,
      sales,
      discount: sales - gross,
      gross,
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

  const exportCsv = () => {
    const m = (v) => (v == null ? '' : fmtMoney(v))
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'created', label: 'Created' },
      { key: 'status', label: 'Status' },
      { key: 'account', label: 'Account' },
      { key: 'appt_date', label: 'Appointment Date' },
      { key: 'appt_time', label: 'Appointment Time' },
      { key: 'customer_id', label: 'Customer ID' },
      { key: 'customer', label: 'Customer' },
      { key: 'customer_phone', label: 'Customer Phone' },
      { key: 'client', label: 'Client' },
      { key: 'branch', label: 'Branch' },
      { key: 'city', label: 'City' },
      { key: 'package', label: 'Package' },
      { key: 'sales', label: 'Sales' },
      { key: 'discount', label: 'Discount' },
      { key: 'gross', label: 'Gross (customer pays)' },
      { key: 'client_gets', label: 'Client Gets' },
      { key: 'agent_gets', label: 'Agent Gets' },
      { key: 'company_net', label: 'GraphicSpark Net' },
      { key: 'agent', label: 'Agent' },
      { key: 'confirmed', label: 'Confirmed' },
      { key: 'notes', label: 'Notes' },
    ]
    const data = filtered.map((o) => ({
      id: o.ref_no,
      created: fmtDate(o.created_at),
      status: cap(o.status),
      account: o.account?.name ?? '',
      appt_date: o.scheduled_date ? fmtDate(o.scheduled_date) : '',
      appt_time: o.scheduled_time ? slotLabel(o.scheduled_time) : '',
      customer_id: o.customer?.ref_no ?? '',
      customer: o.customer?.full_name ?? '',
      customer_phone: o.customer?.phone ? formatPkPhone(o.customer.phone) : '',
      client: o.client?.company_name ?? '',
      branch: o.branch?.branch_name ?? '',
      city: o.branch?.city ?? '',
      package: packageSummary(o),
      sales: m(o.list_amount ?? o.amount),
      discount: discountText(o),
      gross: m(o.amount),
      client_gets: m(o.client_amount),
      agent_gets: m(o.agent_amount),
      company_net: m(o.company_amount),
      agent: o.agent?.full_name ?? '',
      confirmed: o.confirmed_at ? fmtDateTime(o.confirmed_at) : '',
      notes: o.notes ?? '',
    }))
    downloadCsv(`orders_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, data))
    toast.success(`Exported ${data.length} order(s)`)
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
    { key: 'created', header: 'Created', render: (o) => fmtDate(o.created_at) },
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
    { key: 'account', header: 'Account', render: (o) => o.account?.name ?? '—' },
    {
      key: 'appt_date',
      header: 'Appt date',
      render: (o) => (o.scheduled_date ? fmtDate(o.scheduled_date) : '—'),
    },
    {
      key: 'appt_time',
      header: 'Appt time',
      render: (o) => (o.scheduled_time ? slotLabel(o.scheduled_time) : '—'),
    },
    { key: 'package', header: 'Packages', render: (o) => packageSummary(o) },
    { key: 'sales', header: 'Sales', render: (o) => fmtMoney(o.list_amount ?? o.amount) },
    { key: 'discount', header: 'Discount', render: (o) => discountText(o) || '—' },
    { key: 'gross', header: 'Gross', render: (o) => fmtMoney(o.amount) },
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
          {canConfirm && o.status === 'pending' && (
            <button
              className="ok"
              title="Confirm — service availed"
              onClick={() => setToConfirm(o)}
            >
              <BadgeCheck size={13} />
            </button>
          )}
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
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export
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
          { key: 's', label: 'Sales', value: fmtMoney(stats.sales), icon: Wallet },
          { key: 'd', label: 'Discount', value: fmtMoney(stats.discount), icon: Tag },
          { key: 'g', label: 'Gross', value: fmtMoney(stats.gross), icon: Coins },
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
            <div style={{ minWidth: 200 }}>
              <SearchSelect
                value={clientF}
                onChange={(v) => { setClientF(v || 'all'); resetPage() }}
                placeholder="Any client"
                options={[
                  { value: 'all', label: 'Any client' },
                  ...clients.map((c) => ({
                    value: String(c.ref_no),
                    label: c.company_name,
                    sub: String(c.ref_no),
                  })),
                ]}
              />
            </div>
            <div style={{ minWidth: 180 }}>
              <SearchSelect
                value={accountF}
                onChange={(v) => { setAccountF(v || 'all'); resetPage() }}
                placeholder="Any account"
                options={[
                  { value: 'all', label: 'Any account' },
                  ...accounts.map((a) => ({
                    value: String(a.ref_no),
                    label: a.name,
                    sub: String(a.ref_no),
                  })),
                ]}
              />
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(e) => { setMineOnly(e.target.checked); resetPage() }}
              />
              My orders only
            </label>
          </>
        }
        advanced={
          <>
            <div className="field">
              <label htmlFor="f-from">Created from</label>
              <input id="f-from" type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); resetPage() }} />
            </div>
            <div className="field">
              <label htmlFor="f-to">Created to</label>
              <input id="f-to" type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); resetPage() }} />
            </div>
            <div className="field">
              <label htmlFor="f-appt-from">Appointment from</label>
              <input id="f-appt-from" type="date" className="input" value={apptFrom} onChange={(e) => { setApptFrom(e.target.value); resetPage() }} />
            </div>
            <div className="field">
              <label htmlFor="f-appt-to">Appointment to</label>
              <input id="f-appt-to" type="date" className="input" value={apptTo} onChange={(e) => { setApptTo(e.target.value); resetPage() }} />
            </div>
            <div className="field">
              <label>Appt time from</label>
              <TimeSlotPicker value={apptTimeFrom} onChange={(v) => { setApptTimeFrom(v); resetPage() }} />
            </div>
            <div className="field">
              <label>Appt time to</label>
              <TimeSlotPicker value={apptTimeTo} onChange={(v) => { setApptTimeTo(v); resetPage() }} />
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
          accounts={accounts}
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
          accounts={accounts}
          onClose={() => setViewId(null)}
          onChanged={fetchRows}
        />
      )}

      <ConfirmDialog
        open={Boolean(toConfirm)}
        title="Confirm order"
        message={
          toConfirm
            ? `Confirm order ${toConfirm.ref_no} — the customer availed this service? This locks the commission split and cannot be undone.`
            : ''
        }
        confirmLabel="Confirm — service availed"
        busyLabel="Confirming…"
        busy={confirmBusy}
        onConfirm={doConfirm}
        onClose={() => setToConfirm(null)}
      />

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
function AddOrderModal({ clients, accounts, agentId, canAddCustomer, onClose, onDone }) {
  const [customers, setCustomers] = useState([])
  const [f, setF] = useState({
    account_id: '',
    client_id: '',
    branch_id: '',
    customer_id: '',
    scheduled_date: '',
    scheduled_time: '',
    discount_kind: 'none',
    discount_value: '',
    notes: '',
  })
  const [lines, setLines] = useState([])
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
  const listAmt = linesTotal(lines)
  const discAmt = calcDiscount(listAmt, f.discount_kind, f.discount_value)
  const payAmt = finalAmount(listAmt, f.discount_kind, f.discount_value)

  const pickClient = (v) => {
    const cl = clients.find((c) => c.id === v)
    const brs = cl?.client_branches ?? []
    setLines([])
    setF((p) => ({ ...p, client_id: v, branch_id: brs.length === 1 ? brs[0].id : '' }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!f.account_id) return setErr('Pick an account')
    if (!f.client_id) return setErr('Pick a client')
    if (branches.length > 1 && !f.branch_id) return setErr('Pick a branch')
    if (lines.length === 0) return setErr('Add at least one package')
    if (!f.customer_id) return setErr('Pick a customer')
    if (f.discount_kind !== 'none') {
      const dv = Number(f.discount_value)
      if (!dv || dv <= 0) return setErr('Enter the discount')
      if (f.discount_kind === 'percent' && dv > 100) return setErr('Discount % cannot exceed 100')
      if (f.discount_kind === 'fixed' && dv > listAmt) return setErr('Discount cannot exceed the packages total')
    }
    if (payAmt <= 0) return setErr('Amount after discount must be more than 0')

    setBusy(true)
    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        account_id: f.account_id,
        customer_id: f.customer_id,
        client_id: f.client_id,
        branch_id: f.branch_id || branches[0]?.id || null,
        agent_id: agentId,
        created_by: agentId,
        scheduled_date: f.scheduled_date || null,
        scheduled_time: f.scheduled_time || null,
        discount_kind: f.discount_kind,
        discount_value: f.discount_kind === 'none' ? 0 : Number(f.discount_value) || 0,
        notes: f.notes.trim() || null,
        status: 'pending',
      })
      .select('id')
      .single()
    if (error) {
      setBusy(false)
      return setErr(error.message)
    }
    const { error: itemsErr } = await supabase.from('order_items').insert(
      lines.map((l) => ({
        order_id: order.id,
        package_id: l.package_id,
        package_name: l.package_name,
        unit_price: Number(l.unit_price) || 0,
        qty: Number(l.qty) || 1,
        client_kind: l.client_kind,
        client_value: l.client_value,
      })),
    )
    setBusy(false)
    if (itemsErr) {
      await supabase.from('orders').delete().eq('id', order.id) // no half-built order
      return setErr(itemsErr.message)
    }
    toast.success('Order created')
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="Add order" width={520}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        <div className="field">
          <label>Account *</label>
          <SearchSelect
            value={f.account_id}
            onChange={(v) => set('account_id', v)}
            placeholder={accounts.length ? 'Pick an account…' : 'No accounts yet'}
            options={accounts.map((a) => ({ value: a.id, label: `${a.ref_no} · ${a.name}` }))}
          />
          {accounts.length === 0 && (
            <span className="field-hint">Add an account on the Accounts page first.</span>
          )}
        </div>

        <div className="field">
          <label>Client *</label>
          <SearchSelect
            value={f.client_id}
            onChange={pickClient}
            placeholder="Pick a client…"
            options={clients.map((c) => ({ value: c.id, label: `${c.ref_no} · ${c.company_name}` }))}
          />
        </div>

        {branches.length > 1 && (
          <div className="field">
            <label>Branch *</label>
            <SearchSelect
              value={f.branch_id}
              onChange={(v) => set('branch_id', v)}
              placeholder="Pick a branch…"
              options={branches.map((b) => ({
                value: b.id,
                label: b.branch_name,
                sub: `${b.city || '—'}${b.is_primary ? ' · primary' : ''}`,
              }))}
            />
          </div>
        )}

        <div className="field">
          <label>Packages *</label>
          <PackageLines
            lines={lines}
            onChange={setLines}
            packages={pkgs}
            disabled={!f.client_id}
            emptyHint="This client has no active packages"
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

        <WhenFields
          date={f.scheduled_date}
          time={f.scheduled_time}
          onDate={(v) => set('scheduled_date', v)}
          onTime={(v) => set('scheduled_time', v)}
        />

        {lines.length > 0 && (
          <div className="split-box">
            <div className="split-row"><span>Sales ({lines.length} package{lines.length > 1 ? 's' : ''})</span><b>{fmtMoney(listAmt)}</b></div>
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
            <div className="split-row total"><span>Gross (customer pays)</span><b>{fmtMoney(payAmt)}</b></div>
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
function OrderDetailModal({ order, canEdit, canConfirm, clients, accounts, onClose, onChanged }) {
  const [mode, setMode] = useState('view') // view | edit
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(null) // null | 'confirm' | 'cancel' - inline confirm strip

  const isPending = order.status === 'pending'

  const doConfirm = async () => {
    setBusy(true)
    const { error } = await supabase.rpc('confirm_order', { p_order_id: order.id })
    setBusy(false)
    setAsk(null)
    if (error) return toast.error(error.message)
    toast.success(`Order ${order.ref_no} confirmed`)
    onChanged()
  }

  const doCancel = async () => {
    setBusy(true)
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id)
    setBusy(false)
    setAsk(null)
    if (error) return toast.error(error.message)
    toast.success('Order cancelled')
    onChanged()
  }

  if (mode === 'edit') {
    return (
      <EditOrderModal
        order={order}
        clients={clients}
        accounts={accounts}
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
        <Row label="Account" value={order.account ? `${order.account.ref_no} · ${order.account.name}` : '—'} />
        <Row label="Customer" value={`${order.customer?.ref_no} · ${order.customer?.full_name ?? '—'}`} />
        <Row label="Client" value={`${order.client?.ref_no} · ${order.client?.company_name ?? '—'}`} />
        <Row label="Branch" value={order.branch ? `${order.branch.branch_name} · ${order.branch.city}` : '—'} />
        <Row label="Date" value={order.scheduled_date ? fmtDate(order.scheduled_date) : '—'} />
        <Row label="Time" value={order.scheduled_time ? slotLabel(order.scheduled_time) : '—'} />
        <div className="view-row">
          <span className="view-label">Packages</span>
          <span className="view-value">
            {(order.order_items ?? []).length > 0 ? (
              <span className="pos-view-list">
                {order.order_items.map((it) => (
                  <span key={it.id} className="pos-view-line">
                    <span>{it.package_name}{Number(it.qty) > 1 ? ` × ${it.qty}` : ''}</span>
                    <span>{fmtMoney(it.line_total ?? it.unit_price)}</span>
                  </span>
                ))}
              </span>
            ) : (
              order.package_name || order.service || '—'
            )}
          </span>
        </div>
        {order.list_amount != null && order.discount_kind && order.discount_kind !== 'none' ? (
          <>
            <Row label="Sales" value={fmtMoney(order.list_amount)} />
            <Row
              label="Discount"
              value={
                order.discount_kind === 'percent'
                  ? `${order.discount_value}%  (− ${fmtMoney(Number(order.list_amount) - Number(order.amount))})`
                  : `${fmtMoney(order.discount_value)} off`
              }
            />
            <Row label="Gross (customer pays)" value={fmtMoney(order.amount)} />
          </>
        ) : (
          <Row label="Gross" value={fmtMoney(order.amount)} />
        )}
        <Row label="Agent" value={order.agent?.full_name} />
        <Row label="Notes" value={order.notes} />
        <Row label="Created" value={fmtDate(order.created_at)} />
        {order.status === 'confirmed' && (
          <Row label="Confirmed" value={fmtDate(order.confirmed_at)} />
        )}
      </div>

      {ask ? (
        <div className="confirm-inline">
          <span>
            {ask === 'confirm'
              ? `Confirm order ${order.ref_no}? The customer availed this service — this locks the commission split and cannot be undone.`
              : `Cancel order ${order.ref_no}?`}
          </span>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-square" onClick={() => setAsk(null)} disabled={busy}>
              Back
            </button>
            <button
              type="button"
              className={`btn btn-square${ask === 'cancel' ? ' btn-danger' : ''}`}
              onClick={ask === 'confirm' ? doConfirm : doCancel}
              disabled={busy}
            >
              {busy ? 'Working…' : ask === 'confirm' ? 'Yes, confirm' : 'Yes, cancel it'}
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
          {isPending && canEdit && (
            <>
              <button type="button" className="btn btn-ghost btn-square" onClick={() => setAsk('cancel')}>
                Cancel order
              </button>
              <button type="button" className="btn btn-ghost btn-square" onClick={() => setMode('edit')}>
                Edit
              </button>
            </>
          )}
          {isPending && canConfirm && (
            <button type="button" className="btn btn-square" onClick={() => setAsk('confirm')}>
              <BadgeCheck size={14} /> Confirm — service availed
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

function EditOrderModal({ order, clients, accounts, onCancel, onDone }) {
  const [customers, setCustomers] = useState([])
  const [f, setF] = useState(() => {
    const cl = order.client?.ref_no ? clients.find((c) => c.ref_no === order.client.ref_no) : null
    const brs = cl?.client_branches ?? []
    const br =
      brs.find((b) => b.branch_name === order.branch?.branch_name) ||
      brs.find((b) => b.is_primary) ||
      brs[0]
    return {
      account_id: order.account_id ?? '',
      client_id: cl?.id ?? '',
      branch_id: br?.id ?? '',
      customer_id: '',
      scheduled_date: order.scheduled_date ?? '',
      scheduled_time: toSlotValue(order.scheduled_time),
      discount_kind: order.discount_kind ?? 'none',
      discount_value: order.discount_value ? String(order.discount_value) : '',
      notes: order.notes ?? '',
    }
  })
  const [lines, setLines] = useState(() =>
    (order.order_items ?? []).map((it) => ({
      package_id: it.package_id,
      package_name: it.package_name,
      unit_price: Number(it.unit_price) || 0,
      qty: Number(it.qty) || 1,
      client_kind: it.client_kind,
      client_value: it.client_value,
    })),
  )
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
  const pkgs = (selClient?.client_packages ?? []).filter((p) => p.is_active)
  const listAmt = linesTotal(lines)
  const discAmt = calcDiscount(listAmt, f.discount_kind, f.discount_value)
  const payAmt = finalAmount(listAmt, f.discount_kind, f.discount_value)

  const pickClient = (v) => {
    const brs = clients.find((c) => c.id === v)?.client_branches ?? []
    const cur = brs.find((b) => b.branch_name === order.branch?.branch_name)
    if (v !== f.client_id) setLines([])
    setF((p) => ({
      ...p,
      client_id: v,
      branch_id: cur?.id || brs.find((b) => b.is_primary)?.id || brs[0]?.id || '',
    }))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!f.account_id) return setErr('Pick an account')
    if (!f.client_id || !f.customer_id) return setErr('Client and customer are required')
    if (branches.length > 1 && !f.branch_id) return setErr('Pick a branch')
    if (lines.length === 0) return setErr('Add at least one package')
    if (f.discount_kind !== 'none') {
      const dv = Number(f.discount_value)
      if (!dv || dv <= 0) return setErr('Enter the discount')
      if (f.discount_kind === 'percent' && dv > 100) return setErr('Discount % cannot exceed 100')
      if (f.discount_kind === 'fixed' && dv > listAmt) return setErr('Discount cannot exceed the packages total')
    }
    if (payAmt <= 0) return setErr('Amount after discount must be more than 0')

    setBusy(true)
    const { error } = await supabase
      .from('orders')
      .update({
        account_id: f.account_id,
        client_id: f.client_id,
        branch_id: f.branch_id || branches[0]?.id || null,
        customer_id: f.customer_id,
        scheduled_date: f.scheduled_date || null,
        scheduled_time: f.scheduled_time || null,
        discount_kind: f.discount_kind,
        discount_value: f.discount_kind === 'none' ? 0 : Number(f.discount_value) || 0,
        notes: f.notes.trim() || null,
      })
      .eq('id', order.id)
    if (error) {
      setBusy(false)
      return setErr(error.message)
    }
    // replace the line items
    const del = await supabase.from('order_items').delete().eq('order_id', order.id)
    if (del.error) {
      setBusy(false)
      return setErr(del.error.message)
    }
    const ins = await supabase.from('order_items').insert(
      lines.map((l) => ({
        order_id: order.id,
        package_id: l.package_id,
        package_name: l.package_name,
        unit_price: Number(l.unit_price) || 0,
        qty: Number(l.qty) || 1,
        client_kind: l.client_kind,
        client_value: l.client_value,
      })),
    )
    setBusy(false)
    if (ins.error) return setErr(ins.error.message)
    toast.success('Order updated')
    onDone()
  }

  return (
    <Modal open onClose={onCancel} title={`Edit order ${order.ref_no}`} width={520}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}
        <div className="field">
          <label>Account *</label>
          <SearchSelect
            value={f.account_id}
            onChange={(v) => set('account_id', v)}
            options={accounts.map((a) => ({ value: a.id, label: `${a.ref_no} · ${a.name}` }))}
          />
        </div>
        <div className="field">
          <label>Client *</label>
          <SearchSelect
            value={f.client_id}
            onChange={pickClient}
            options={clients.map((c) => ({ value: c.id, label: `${c.ref_no} · ${c.company_name}` }))}
          />
        </div>
        {branches.length > 1 && (
          <div className="field">
            <label>Branch *</label>
            <SearchSelect
              value={f.branch_id}
              onChange={(v) => set('branch_id', v)}
              options={branches.map((b) => ({ value: b.id, label: b.branch_name, sub: b.city || '—' }))}
            />
          </div>
        )}
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
          <label>Packages *</label>
          <PackageLines
            lines={lines}
            onChange={setLines}
            packages={pkgs}
            disabled={!f.client_id}
            emptyHint="This client has no active packages"
          />
          <span className="field-hint">
            Adding a package applies its current price and rate. Confirmed orders are never affected.
          </span>
        </div>
        {lines.length > 0 && (
          <div className="split-box">
            <div className="split-row"><span>Sales</span><b>{fmtMoney(listAmt)}</b></div>
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
            <div className="split-row total"><span>Gross (customer pays)</span><b>{fmtMoney(payAmt)}</b></div>
          </div>
        )}
        <WhenFields
          date={f.scheduled_date}
          time={f.scheduled_time}
          onDate={(v) => set('scheduled_date', v)}
          onTime={(v) => set('scheduled_time', v)}
        />
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
