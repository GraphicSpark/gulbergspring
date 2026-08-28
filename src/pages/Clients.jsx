import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Building2,
  Download,
  Eye,
  FileDown,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Upload,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate } from '../lib/format'
import {
  formatPkPhone,
  fromStored,
  isValidPkMobile,
  pkPhoneError,
  toLocal,
  toStored,
} from '../lib/phone'
import { downloadCsv, parseCsv, toCsv } from '../lib/csv'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import PkPhoneInput from '../components/PkPhoneInput'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import BulkBar from '../components/data/BulkBar'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15
const STATUSES = ['active', 'lead', 'inactive']
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

const SELECT =
  'id, ref_no, company_name, status, notes, created_at, client_branches(id, branch_name, city, poc_name, poc_phone, poc_email, address, is_primary, created_at), client_packages(id)'

const primaryOf = (c) =>
  (c.client_branches ?? []).find((b) => b.is_primary) || (c.client_branches ?? [])[0] || null

const SAMPLE_CSV = [
  'Company,Branch,City,POC Name,POC Contact,POC Email',
  'Acme Textiles,Head Office,Lahore,Imran Khan,3001234567,imran@acme.pk',
  'Acme Textiles,Karachi Branch,Karachi,Sana Ali,3211234567,',
  'Zephyr Foods,Main,Islamabad,Bilal Ahmed,3331234567,bilal@zephyr.pk',
].join('\r\n')

function BranchForm({ initial, onSave, onCancel, busy }) {
  const [f, setF] = useState(
    initial ?? { branch_name: 'Main', phoneLocal: '', city: '', poc_name: '', poc_email: '', is_primary: false },
  )
  const [err, setErr] = useState('')
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }))
  const phoneErr = pkPhoneError(f.phoneLocal)

  const submit = (e) => {
    e.preventDefault()
    setErr('')
    if (!f.branch_name.trim()) return setErr('Branch name is required')
    if (!f.city.trim()) return setErr('City is required')
    if (!f.poc_name.trim()) return setErr('POC name is required')
    if (!isValidPkMobile(f.phoneLocal)) return setErr(phoneErr || 'Invalid POC contact')
    onSave({
      branch_name: f.branch_name.trim(),
      city: f.city.trim(),
      poc_name: f.poc_name.trim(),
      poc_phone: toStored(f.phoneLocal),
      poc_email: f.poc_email.trim() || null,
      is_primary: f.is_primary,
    })
  }

  return (
    <form className="modal-form" onSubmit={submit}>
      {err && <div className="modal-error">{err}</div>}
      <div className="field-row">
        <div className="field">
          <label>Branch name *</label>
          <input className="input" value={f.branch_name} onChange={(e) => set('branch_name', e.target.value)} />
        </div>
        <div className="field">
          <label>City *</label>
          <input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label>POC name *</label>
        <input className="input" value={f.poc_name} onChange={(e) => set('poc_name', e.target.value)} />
      </div>
      <div className="field-row">
        <div className="field">
          <label>POC contact *</label>
          <PkPhoneInput
            value={f.phoneLocal}
            onChange={(v) => set('phoneLocal', v)}
            invalid={Boolean(f.phoneLocal) && Boolean(phoneErr)}
          />
          {f.phoneLocal && phoneErr && <span className="field-error">{phoneErr}</span>}
        </div>
        <div className="field">
          <label>POC email (optional)</label>
          <input className="input" type="email" value={f.poc_email} onChange={(e) => set('poc_email', e.target.value)} />
        </div>
      </div>
      <label className="check-line">
        <input type="checkbox" checked={f.is_primary} onChange={(e) => set('is_primary', e.target.checked)} />
        Primary branch (head office)
      </label>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-square" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-square" disabled={busy}>
          {busy ? 'Saving…' : 'Save branch'}
        </button>
      </div>
    </form>
  )
}

export default function Clients() {
  const { can, profile } = useAuth()
  const canView = can('clients', 'view')
  const canAdd = can('clients', 'add')
  const canEdit = can('clients', 'edit')
  const canDelete = can('clients', 'delete')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [viewId, setViewId] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [del, setDel] = useState(null)
  const [delBusy, setDelBusy] = useState(false)

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('clients')
      .select(SELECT)
      .order('created_at', { ascending: false })
    if (error) toast.error('Could not load clients')
    setRows(data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const viewClient = rows.find((c) => c.id === viewId) || null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((c) => {
      if (status !== 'all' && c.status !== status) return false
      if (from && c.created_at < from) return false
      if (to && c.created_at > `${to}T23:59:59`) return false
      if (q) {
        const branchText = (c.client_branches ?? [])
          .map((b) => `${b.branch_name} ${b.city ?? ''} ${b.poc_name ?? ''} ${b.poc_phone ?? ''}`)
          .join(' ')
        if (!`${c.company_name} ${branchText}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, search, status, from, to])

  const activeFilters = (status !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)
  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setStatus('all')
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
      month: rows.filter((c) => new Date(c.created_at) >= monthStart).length,
      branches: rows.reduce((n, c) => n + (c.client_branches?.length ?? 0), 0),
    }
  }, [rows])

  const doDelete = async () => {
    if (!del) return
    setDelBusy(true)
    const ids = del.kind === 'bulk' ? [...del.ids] : [del.row.id]
    const { error } = await supabase.from('clients').delete().in('id', ids)
    setDelBusy(false)
    if (error) return toast.error(error.message)
    toast.success(`${ids.length} client(s) deleted`)
    setDel(null)
    setBulkAction('')
    fetchRows()
  }

  const exportCsv = () => {
    const headers = [
      { key: 'id', label: 'ID' },
      { key: 'company', label: 'Company' },
      { key: 'branch', label: 'Branch' },
      { key: 'city', label: 'City' },
      { key: 'poc', label: 'POC Name' },
      { key: 'contact', label: 'POC Contact' },
      { key: 'email', label: 'POC Email' },
      { key: 'primary', label: 'Primary' },
      { key: 'status', label: 'Status' },
      { key: 'added', label: 'Added' },
    ]
    const data = []
    for (const c of filtered) {
      for (const b of c.client_branches ?? []) {
        data.push({
          id: c.ref_no,
          company: c.company_name,
          branch: b.branch_name,
          city: b.city ?? '',
          poc: b.poc_name ?? '',
          contact: b.poc_phone ? formatPkPhone(b.poc_phone) : '',
          email: b.poc_email ?? '',
          primary: b.is_primary ? 'Yes' : '',
          status: c.status,
          added: fmtDate(c.created_at),
        })
      }
    }
    downloadCsv(`clients_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, data))
    toast.success(`Exported ${data.length} branch row(s)`)
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
      prev.size === pageRows.length ? new Set() : new Set(pageRows.map((c) => c.id)),
    )

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <Building2 size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Clients.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (c) => c.ref_no },
    { key: 'name', header: 'Client name', render: (c) => <span className="primary">{c.company_name}</span> },
    {
      key: 'branches',
      header: 'Branches',
      render: (c) => (c.client_branches?.length ?? 0),
    },
    { key: 'city', header: 'City', render: (c) => primaryOf(c)?.city || '—' },
    { key: 'poc', header: 'POC', render: (c) => primaryOf(c)?.poc_name || '—' },
    {
      key: 'packages',
      header: 'Packages',
      render: (c) => c.client_packages?.length ?? 0,
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (c) => (primaryOf(c)?.poc_phone ? formatPkPhone(primaryOf(c).poc_phone) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <span className={`status-text ${c.status === 'active' ? 'on' : c.status === 'inactive' ? 'bad' : 'off'}`}>{cap(c.status)}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (c) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button title="View" onClick={() => setViewId(c.id)}>
            <Eye size={13} />
          </button>
          {canDelete && (
            <button className="danger" title="Delete" onClick={() => setDel({ kind: 'one', row: c })}>
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
          <h1 className="page-title">Clients</h1>
          <p className="page-subtitle">{stats.total} company client(s)</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canAdd && (
            <button className="btn btn-ghost btn-square btn-sm" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import
            </button>
          )}
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export
          </button>
          {canAdd && (
            <button className="btn" onClick={() => setAddOpen(true)}>
              <Plus size={15} /> Add Client
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 't', label: 'Clients', value: stats.total, icon: Building2 },
          { key: 'b', label: 'Branches', value: stats.branches, icon: MapPin },
          { key: 'm', label: 'This month', value: stats.month, icon: Building2 },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          resetPage()
        }}
        searchPlaceholder="Search company, branch, city or POC..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <select
            className="filter-select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              resetPage()
            }}
          >
            <option value="all">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
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
        rowKey={(c) => c.id}
        loading={loading}
        emptyLabel="No clients match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        title="Clients"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <AddClientModal
          createdBy={profile?.id}
          onClose={() => setAddOpen(false)}
          onDone={() => {
            setAddOpen(false)
            fetchRows()
          }}
        />
      )}

      {viewClient && (
        <ClientDetailModal
          client={viewClient}
          canEdit={canEdit}
          canAdd={canAdd}
          canDelete={canDelete}
          onClose={() => setViewId(null)}
          onChanged={fetchRows}
        />
      )}

      {importOpen && (
        <ImportModal
          existing={rows}
          createdBy={profile?.id}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false)
            fetchRows()
          }}
        />
      )}

      {del && (
        <ConfirmDelete
          open
          title={del.kind === 'bulk' ? 'Delete clients' : 'Delete client'}
          message={
            del.kind === 'bulk'
              ? `This permanently deletes ${del.ids.size} client(s) and all their branches.`
              : `This permanently deletes ${del.row.company_name} and its ${del.row.client_branches?.length ?? 0} branch(es).`
          }
          busy={delBusy}
          onConfirm={doDelete}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  )
}

// ── Add client (company + first/primary branch) ───────────────────────────
function AddClientModal({ createdBy, onClose, onDone }) {
  const [company, setCompany] = useState('')
  const [status, setStatus] = useState('active')
  const [notes, setNotes] = useState('')
  const [branch, setBranch] = useState({
    branch_name: 'Main',
    phoneLocal: '',
    city: '',
    poc_name: '',
    poc_email: '',
  })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const setB = (k, v) => setBranch((p) => ({ ...p, [k]: v }))
  const phoneErr = pkPhoneError(branch.phoneLocal)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!company.trim()) return setErr('Client name is required')
    if (!branch.branch_name.trim()) return setErr('Branch name is required')
    if (!branch.city.trim()) return setErr('City is required')
    if (!branch.poc_name.trim()) return setErr('POC name is required')
    if (!isValidPkMobile(branch.phoneLocal)) return setErr(phoneErr || 'Invalid POC contact')

    setBusy(true)
    const { data: client, error: cErr } = await supabase
      .from('clients')
      .insert({
        company_name: company.trim(),
        status,
        notes: notes.trim() || null,
        created_by: createdBy,
      })
      .select('id')
      .single()
    if (cErr || !client) {
      setBusy(false)
      return setErr(cErr?.message ?? 'Could not create client')
    }
    const { error: bErr } = await supabase.from('client_branches').insert({
      client_id: client.id,
      branch_name: branch.branch_name.trim(),
      city: branch.city.trim(),
      poc_name: branch.poc_name.trim(),
      poc_phone: toStored(branch.phoneLocal),
      poc_email: branch.poc_email.trim() || null,
      is_primary: true,
    })
    setBusy(false)
    if (bErr) {
      await supabase.from('clients').delete().eq('id', client.id)
      return setErr(bErr.message)
    }
    toast.success('Client added')
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="Add client" width={520}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        <div className="field-row">
          <div className="field">
            <label htmlFor="cl-name">Client name *</label>
            <input id="cl-name" className="input" value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="cl-status">Status</label>
            <select id="cl-status" className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {cap(s)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 6 }}>Primary branch</div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="cl-branch">Branch name *</label>
            <input id="cl-branch" className="input" value={branch.branch_name} onChange={(e) => setB('branch_name', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cl-city">City *</label>
            <input id="cl-city" className="input" value={branch.city} onChange={(e) => setB('city', e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="cl-poc">POC name *</label>
          <input id="cl-poc" className="input" value={branch.poc_name} onChange={(e) => setB('poc_name', e.target.value)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="cl-phone">POC contact *</label>
            <PkPhoneInput
              id="cl-phone"
              value={branch.phoneLocal}
              onChange={(v) => setB('phoneLocal', v)}
              invalid={Boolean(branch.phoneLocal) && Boolean(phoneErr)}
            />
            {branch.phoneLocal && phoneErr && <span className="field-error">{phoneErr}</span>}
          </div>
          <div className="field">
            <label htmlFor="cl-email">POC email (optional)</label>
            <input id="cl-email" type="email" className="input" value={branch.poc_email} onChange={(e) => setB('poc_email', e.target.value)} autoComplete="off" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="cl-notes">Notes (optional)</label>
          <textarea id="cl-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <p className="field-hint">
          Next, add this client&rsquo;s packages on the Packages page — orders can only be
          created once a client has at least one active package.
        </p>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-square" disabled={busy}>
            {busy ? 'Saving…' : 'Add client'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Client detail: company info + branches ────────────────────────────────
function ClientDetailModal({ client, canEdit, canAdd, canDelete, onClose, onChanged }) {
  const [tab, setTab] = useState('info') // info | editCompany | branchForm
  const [editBranch, setEditBranch] = useState(null) // branch row or 'new'
  const [busy, setBusy] = useState(false)

  const [company, setCompany] = useState(client.company_name)
  const [status, setStatus] = useState(client.status)
  const [notes, setNotes] = useState(client.notes ?? '')

  const branches = [...(client.client_branches ?? [])].sort(
    (a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0),
  )

  const saveCompany = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase
      .from('clients')
      .update({
        company_name: company.trim(),
        status,
        notes: notes.trim() || null,
      })
      .eq('id', client.id)
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success('Client updated')
    onChanged()
    setTab('info')
  }

  const saveBranch = async (data) => {
    setBusy(true)
    if (data.is_primary) {
      let q = supabase.from('client_branches').update({ is_primary: false }).eq('client_id', client.id)
      if (editBranch && editBranch !== 'new') q = q.neq('id', editBranch.id)
      await q
    }
    const op =
      editBranch && editBranch !== 'new'
        ? supabase.from('client_branches').update(data).eq('id', editBranch.id)
        : supabase.from('client_branches').insert({ ...data, client_id: client.id })
    const { error } = await op
    setBusy(false)
    if (error) return toast.error(error.message)
    toast.success(editBranch === 'new' ? 'Branch added' : 'Branch updated')
    onChanged()
    setEditBranch(null)
    setTab('info')
  }

  const removeBranch = async (b) => {
    if (branches.length <= 1) return toast.error('A client must keep at least one branch')
    if (!window.confirm(`Delete branch "${b.branch_name}"?`)) return
    const { error } = await supabase.from('client_branches').delete().eq('id', b.id)
    if (error) return toast.error(error.message)
    toast.success('Branch deleted')
    onChanged()
  }

  // branch add / edit form view
  if (tab === 'branchForm' && editBranch) {
    const initial =
      editBranch === 'new'
        ? undefined
        : {
            branch_name: editBranch.branch_name ?? 'Main',
            phoneLocal: fromStored(editBranch.poc_phone),
            city: editBranch.city ?? '',
            poc_name: editBranch.poc_name ?? '',
            poc_email: editBranch.poc_email ?? '',
            is_primary: editBranch.is_primary,
          }
    return (
      <Modal open onClose={onClose} title={editBranch === 'new' ? 'Add branch' : 'Edit branch'} width={500}>
        <BranchForm
          initial={initial}
          busy={busy}
          onSave={saveBranch}
          onCancel={() => {
            setEditBranch(null)
            setTab('info')
          }}
        />
      </Modal>
    )
  }

  // edit company view
  if (tab === 'editCompany') {
    return (
      <Modal open onClose={onClose} title="Edit client" width={480}>
        <form className="modal-form" onSubmit={saveCompany}>
          <div className="field">
            <label>Client name *</label>
            <input className="input" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="field">
            <label>Status</label>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {cap(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Notes (optional)</label>
            <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-square" onClick={() => setTab('info')}>
              Cancel
            </button>
            <button type="submit" className="btn btn-square" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    )
  }

  // main info view
  return (
    <Modal open onClose={onClose} title={`${client.ref_no} · ${client.company_name}`} width={520}>
      <div className="view-row">
        <span className="view-label">Status</span>
        <span className="view-value">{cap(client.status)}</span>
      </div>
      <div className="view-row">
        <span className="view-label">Packages</span>
        <span className="view-value">
          {client.client_packages?.length ?? 0} — manage on the Packages page
        </span>
      </div>
      {client.notes && (
        <div className="view-row">
          <span className="view-label">Notes</span>
          <span className="view-value">{client.notes}</span>
        </div>
      )}
      <div className="view-row">
        <span className="view-label">Added</span>
        <span className="view-value">{fmtDate(client.created_at)}</span>
      </div>

      <div className="branch-head">
        <span>Branches ({branches.length})</span>
        {canAdd && (
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm"
            onClick={() => {
              setEditBranch('new')
              setTab('branchForm')
            }}
          >
            <Plus size={13} /> Add branch
          </button>
        )}
      </div>

      <div className="branch-list">
        {branches.map((b) => (
          <div className="branch-item" key={b.id}>
            <div className="branch-item-main">
              <div className="branch-item-name">
                {b.is_primary && <Star size={12} className="branch-star" />}
                {b.branch_name}
                <span className="branch-item-city">· {b.city || '—'}</span>
              </div>
              <div className="branch-item-poc">
                {b.poc_name || '—'} · {b.poc_phone ? formatPkPhone(b.poc_phone) : '—'}
                {b.poc_email ? ` · ${b.poc_email}` : ''}
              </div>
            </div>
            {(canEdit || canDelete) && (
              <div className="row-actions">
                {canEdit && (
                  <button
                    title="Edit branch"
                    onClick={() => {
                      setEditBranch(b)
                      setTab('branchForm')
                    }}
                  >
                    <Pencil size={12} />
                  </button>
                )}
                {canDelete && branches.length > 1 && (
                  <button className="danger" title="Delete branch" onClick={() => removeBranch(b)}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
          Close
        </button>
        {canEdit && (
          <button type="button" className="btn btn-square" onClick={() => setTab('editCompany')}>
            <Pencil size={14} /> Edit client
          </button>
        )}
      </div>
    </Modal>
  )
}

// ── Import CSV ────────────────────────────────────────────────────────────
const pick = (headerRow, ...names) => {
  const lower = headerRow.map((h) => h.trim().toLowerCase())
  for (const n of names) {
    const i = lower.findIndex((h) => h === n || h.includes(n))
    if (i !== -1) return i
  }
  return -1
}

function ImportModal({ existing, createdBy, onClose, onDone }) {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const rows = parseCsv(await file.text())
    if (rows.length < 2) return toast.error('CSV has no data rows')
    const head = rows[0]
    const iCo = pick(head, 'company', 'client', 'company name')
    const iBr = pick(head, 'branch', 'branch name')
    const iCity = pick(head, 'city')
    const iPoc = pick(head, 'poc name', 'poc', 'contact person', 'contact name')
    const iPhone = pick(head, 'poc contact', 'contact', 'phone', 'mobile')
    const iEmail = pick(head, 'poc email', 'email')

    if (iCo === -1 || iBr === -1 || iCity === -1 || iPoc === -1 || iPhone === -1) {
      return toast.error('CSV needs Company, Branch, City, POC Name, POC Contact columns')
    }

    // group by company
    const groups = new Map() // lowerName -> { name, branches: [] }
    const skipped = []
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      const co = (row[iCo] ?? '').trim()
      const br = (row[iBr] ?? '').trim()
      const city = (row[iCity] ?? '').trim()
      const poc = (row[iPoc] ?? '').trim()
      const local = toLocal(row[iPhone] ?? '')
      if (!co || !br || !city || !poc) {
        skipped.push({ line: r + 1, reason: 'missing required cell' })
        continue
      }
      if (!isValidPkMobile(local)) {
        skipped.push({ line: r + 1, reason: `invalid POC contact "${(row[iPhone] ?? '').trim()}"` })
        continue
      }
      const key = co.toLowerCase()
      if (!groups.has(key)) groups.set(key, { name: co, branches: [] })
      groups.get(key).branches.push({
        branch_name: br,
        city,
        poc_name: poc,
        poc_phone: toStored(local),
        poc_email: iEmail !== -1 ? (row[iEmail] ?? '').trim() || null : null,
      })
    }
    const companies = [...groups.values()]
    setPreview({
      companies,
      branchCount: companies.reduce((n, g) => n + g.branches.length, 0),
      skipped,
    })
  }

  const doImport = async () => {
    if (!preview?.companies.length) return
    setBusy(true)
    const existByName = new Map(existing.map((c) => [c.company_name.toLowerCase(), c]))
    let newClients = 0
    let newBranches = 0
    try {
      for (const g of preview.companies) {
        let clientId = existByName.get(g.name.toLowerCase())?.id
        let hasPrimary = Boolean(existByName.get(g.name.toLowerCase()))
        if (!clientId) {
          const { data, error } = await supabase
            .from('clients')
            .insert({ company_name: g.name, status: 'active', created_by: createdBy })
            .select('id')
            .single()
          if (error) throw error
          clientId = data.id
          newClients++
        }
        const branchRows = g.branches.map((b, idx) => ({
          ...b,
          client_id: clientId,
          is_primary: !hasPrimary && idx === 0,
        }))
        const { error } = await supabase.from('client_branches').insert(branchRows)
        if (error) throw error
        newBranches += branchRows.length
        hasPrimary = true
      }
      toast.success(`Imported ${newBranches} branch(es) across ${newClients} new client(s)`)
      onDone()
    } catch (err) {
      toast.error(err.message ?? 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Import clients" width={480}>
      <div className="modal-form">
        <p className="field-hint">
          One row per <b>branch</b>. Columns: <b>Company</b>, <b>Branch</b>, <b>City</b>,{' '}
          <b>POC Name</b>, <b>POC Contact</b> (POC Email optional). Rows are grouped by Company;
          a new company&rsquo;s first branch becomes its primary.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-square" onClick={() => downloadCsv('clients_sample.csv', SAMPLE_CSV)}>
            <FileDown size={14} /> Download sample
          </button>
          <button type="button" className="btn btn-ghost btn-square" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Choose CSV file
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />

        {preview && (
          <div className="import-summary">
            <div>
              <b>{preview.companies.length}</b> company group(s), <b>{preview.branchCount}</b> branch row(s) ready
            </div>
            {preview.skipped.length > 0 && (
              <>
                <div className="import-skip-head">{preview.skipped.length} row(s) skipped:</div>
                <ul className="import-skip-list">
                  {preview.skipped.slice(0, 8).map((s) => (
                    <li key={s.line}>Line {s.line} — {s.reason}</li>
                  ))}
                  {preview.skipped.length > 8 && <li>…and {preview.skipped.length - 8} more</li>}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-square" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-square" onClick={doImport} disabled={busy || !preview?.branchCount}>
            {busy ? 'Importing…' : `Import ${preview?.branchCount || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
