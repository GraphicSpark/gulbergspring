import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Eye, Landmark, MapPin, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import { dbErrorMessage } from '../lib/errors'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import SearchSelect from '../components/SearchSelect'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import BulkBar from '../components/data/BulkBar'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15

const SELECT = 'id, ref_no, name, location, created_at, manager:manager_id ( id, full_name )'

function ViewRow({ label, value }) {
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <span className="view-value">{value || '—'}</span>
    </div>
  )
}

export default function Accounts() {
  const { can, profile } = useAuth()
  const canView = can('accounts', 'view')
  const canAdd = can('accounts', 'add')
  const canEdit = can('accounts', 'edit')
  const canDelete = can('accounts', 'delete')

  const [rows, setRows] = useState([])
  const [managers, setManagers] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [nameF, setNameF] = useState('all')
  const [managerF, setManagerF] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [viewRow, setViewRow] = useState(null)
  const [del, setDel] = useState(null)
  const [delBusy, setDelBusy] = useState(false)

  const fetchRows = useCallback(async () => {
    const [{ data, error }, mgr] = await Promise.all([
      supabase.from('accounts').select(SELECT).order('created_at', { ascending: false }),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name'),
    ])
    if (error) toast.error('Could not load accounts')
    setRows(data ?? [])
    setManagers(mgr.data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((a) => {
      if (nameF !== 'all' && a.id !== nameF) return false
      if (managerF !== 'all' && a.manager?.id !== managerF) return false
      if (from && a.created_at < from) return false
      if (to && a.created_at > `${to}T23:59:59`) return false
      if (q) {
        const hay = `${a.ref_no} ${a.name} ${a.location ?? ''} ${a.manager?.full_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, nameF, managerF, from, to])

  const activeFilters =
    (nameF !== 'all' ? 1 : 0) + (managerF !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)

  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setNameF('all')
    setManagerF('all')
    setFrom('')
    setTo('')
    setSearch('')
    setPage(1)
  }
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const stats = useMemo(() => {
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    return {
      total: rows.length,
      month: rows.filter((a) => new Date(a.created_at) >= monthStart).length,
    }
  }, [rows])

  const doDelete = async () => {
    if (!del) return
    setDelBusy(true)
    const ids = del.kind === 'bulk' ? [...del.ids] : [del.row.id]
    const { error } = await supabase.from('accounts').delete().in('id', ids)
    setDelBusy(false)
    if (error) return toast.error(dbErrorMessage(error, 'account'))
    toast.success(`${ids.length} account(s) deleted`)
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
    setSelected((prev) => (prev.size === pageRows.length ? new Set() : new Set(pageRows.map((a) => a.id))))

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Landmark size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Accounts.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (a) => a.ref_no },
    { key: 'name', header: 'Account name', render: (a) => <span className="primary">{a.name}</span> },
    { key: 'manager', header: 'Account manager', render: (a) => a.manager?.full_name ?? '—' },
    { key: 'location', header: 'Location', render: (a) => a.location || '—' },
    { key: 'added', header: 'Added', render: (a) => fmtDate(a.created_at) },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (a) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button title="View" onClick={() => setViewRow(a)}>
            <Eye size={13} />
          </button>
          {canDelete && (
            <button className="danger" title="Delete" onClick={() => setDel({ kind: 'one', row: a })}>
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
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">{stats.total} account(s)</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canAdd && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Account
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 't', label: 'Total', value: stats.total, icon: Landmark },
          { key: 'm', label: 'This month', value: stats.month, icon: MapPin },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          resetPage()
        }}
        searchPlaceholder="Search name, location or manager..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <>
            <div style={{ minWidth: 200 }}>
              <SearchSelect
                value={nameF}
                onChange={(v) => {
                  setNameF(v || 'all')
                  resetPage()
                }}
                placeholder="Any account"
                options={[
                  { value: 'all', label: 'Any account' },
                  ...rows.map((a) => ({ value: a.id, label: a.name, sub: String(a.ref_no) })),
                ]}
              />
            </div>
            <div style={{ minWidth: 200 }}>
              <SearchSelect
                value={managerF}
                onChange={(v) => {
                  setManagerF(v || 'all')
                  resetPage()
                }}
                placeholder="Any manager"
                options={[
                  { value: 'all', label: 'Any manager' },
                  ...managers.map((m) => ({ value: m.id, label: m.full_name })),
                ]}
              />
            </div>
          </>
        }
        advanced={
          <>
            <div className="field">
              <label htmlFor="f-from">Added from</label>
              <input id="f-from" type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); resetPage() }} />
            </div>
            <div className="field">
              <label htmlFor="f-to">Added to</label>
              <input id="f-to" type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); resetPage() }} />
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
        rowKey={(a) => a.id}
        loading={loading}
        emptyLabel="No accounts match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        title="Accounts"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <AccountModal
          mode="edit"
          managers={managers}
          createdBy={profile?.id}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            fetchRows()
          }}
        />
      )}

      {viewRow && (
        <AccountModal
          mode="view"
          row={viewRow}
          managers={managers}
          canEdit={canEdit}
          onClose={() => setViewRow(null)}
          onDone={() => {
            setViewRow(null)
            fetchRows()
          }}
        />
      )}

      {del && (
        <ConfirmDelete
          open
          title={del.kind === 'bulk' ? 'Delete accounts' : 'Delete account'}
          message={
            del.kind === 'bulk'
              ? `This permanently deletes ${del.ids.size} selected account(s).`
              : `This permanently deletes ${del.row.name}.`
          }
          busy={delBusy}
          onConfirm={doDelete}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  )
}

// ── View / Add / Edit ─────────────────────────────────────────────────────
function AccountModal({ mode: initialMode, row, managers, canEdit, createdBy, onClose, onDone }) {
  const [mode, setMode] = useState(initialMode) // 'view' | 'edit'
  const editing = Boolean(row)

  const [form, setForm] = useState(
    row
      ? { name: row.name ?? '', manager_id: row.manager?.id ?? '', location: row.location ?? '' }
      : { name: '', manager_id: '', location: '' },
  )
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) return setErr('Account name is required')
    if (!form.manager_id) return setErr('Pick an account manager')
    if (!form.location.trim()) return setErr('Location is required')

    setBusy(true)
    const payload = {
      name: form.name.trim(),
      manager_id: form.manager_id,
      location: form.location.trim(),
    }
    const q = editing
      ? supabase.from('accounts').update(payload).eq('id', row.id)
      : supabase.from('accounts').insert({ ...payload, created_by: createdBy })
    const { error } = await q
    setBusy(false)
    if (error) return setErr(error.message)
    toast.success(editing ? 'Account updated' : 'Account added')
    onDone()
  }

  const title = mode === 'view' ? row.name : editing ? 'Edit account' : 'Add account'

  if (mode === 'view') {
    return (
      <Modal open onClose={onClose} title={title} width={460}>
        <div>
          <ViewRow label="Account ID" value={row.ref_no} />
          <ViewRow label="Account name" value={row.name} />
          <ViewRow label="Account manager" value={row.manager?.full_name} />
          <ViewRow label="Location" value={row.location} />
          <ViewRow label="Added" value={fmtDate(row.created_at)} />
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Close
          </button>
          {canEdit && (
            <button type="button" className="btn btn-square" onClick={() => setMode('edit')}>
              <Pencil size={14} /> Edit
            </button>
          )}
        </div>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={title} width={460}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        <div className="field">
          <label htmlFor="a-name">Account name *</label>
          <input
            id="a-name"
            className="input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label>Account manager *</label>
          <SearchSelect
            value={form.manager_id}
            onChange={(v) => set('manager_id', v)}
            placeholder="Pick an internal user…"
            options={managers.map((m) => ({ value: m.id, label: m.full_name }))}
          />
        </div>

        <div className="field">
          <label htmlFor="a-loc">Location *</label>
          <input
            id="a-loc"
            className="input"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost btn-square"
            onClick={editing && initialMode === 'view' ? () => setMode('view') : onClose}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
