import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Download,
  Eye,
  FileDown,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserRound,
  Users as UsersIcon,
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
import { dbErrorMessage } from '../lib/errors'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import PkPhoneInput from '../components/PkPhoneInput'
import PhoneLink from '../components/PhoneLink'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import BulkBar from '../components/data/BulkBar'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 15
const SOURCES = ['walk-in', 'referral', 'social', 'other']
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '')

const EMPTY = { full_name: '', phoneLocal: '', source: '', notes: '' }

const SAMPLE_CSV = [
  'Name,Phone,Source',
  'Ayesha Siddiqui,3001234567,referral',
  'Bilal Ahmed,+92 321 9876543,walk-in',
].join('\r\n')

function ViewRow({ label, value }) {
  return (
    <div className="view-row">
      <span className="view-label">{label}</span>
      <span className="view-value">{value || '—'}</span>
    </div>
  )
}

export default function Customers() {
  const { can, profile } = useAuth()
  const canView = can('customers', 'view')
  const canAdd = can('customers', 'add')
  const canEdit = can('customers', 'edit')
  const canDelete = can('customers', 'delete')

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [source, setSource] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [sharedPhone, setSharedPhone] = useState('') // phone handed in via the PWA share target / ?phone=
  const [viewRow, setViewRow] = useState(null)
  const [importOpen, setImportOpen] = useState(false)

  // PWA "share a number to the app" / deep link: /customers?phone=03001234567
  // (Android share_target posts the number as `shared_text`). Open Add Customer
  // with the phone pre-filled; the URL params are wiped when the modal closes.
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    if (addOpen || !canAdd) return
    const raw =
      searchParams.get('phone') ||
      searchParams.get('shared_text') ||
      searchParams.get('shared_title') ||
      searchParams.get('shared_url') ||
      ''
    if (!raw) return
    const local = toLocal(raw)
    setSharedPhone(isValidPkMobile(local) ? local : '')
    setAddOpen(true)
    if (!isValidPkMobile(local)) toast('Couldn’t read a phone number - enter it manually')
  }, [searchParams, canAdd, addOpen])
  const [del, setDel] = useState(null) // { kind: 'one'|'bulk', row?, ids? }
  const [delBusy, setDelBusy] = useState(false)

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('customers')
      .select('id, ref_no, full_name, phone, source, notes, created_at')
      .order('created_at', { ascending: false })
    if (error) toast.error('Could not load customers')
    setRows(data ?? [])
    setSelected(new Set())
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((c) => {
      if (source !== 'all' && c.source !== source) return false
      if (from && c.created_at < from) return false
      if (to && c.created_at > `${to}T23:59:59`) return false
      if (q) {
        const hay = `${c.full_name} ${c.phone ?? ''} ${formatPkPhone(c.phone)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, source, from, to])

  const activeFilters = (source !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)

  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setSource('all')
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
    }
  }, [rows])

  const doDelete = async () => {
    if (!del) return
    setDelBusy(true)
    const ids = del.kind === 'bulk' ? [...del.ids] : [del.row.id]
    const { error } = await supabase.from('customers').delete().in('id', ids)
    setDelBusy(false)
    if (error) return toast.error(dbErrorMessage(error, 'customer'))
    toast.success(`${ids.length} customer(s) deleted`)
    setDel(null)
    setBulkAction('')
    fetchRows()
  }

  const exportCsv = () => {
    const headers = [
      { key: 'ref_no', label: 'ID' },
      { key: 'full_name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'source', label: 'Source' },
      { key: 'created_at', label: 'Added' },
    ]
    const data = filtered.map((c) => ({
      ...c,
      phone: c.phone ? formatPkPhone(c.phone) : '',
      created_at: fmtDate(c.created_at),
    }))
    downloadCsv(`customers_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, data))
    toast.success(`Exported ${data.length} customer(s)`)
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
          <UserRound size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Customers.</p>
        </div>
      </div>
    )
  }

  const columns = [
    { key: 'ref', header: 'ID', render: (c) => c.ref_no },
    {
      key: 'name',
      header: 'Name',
      render: (c) => <span className="primary">{c.full_name}</span>,
    },
    { key: 'phone', header: 'Contact', render: (c) => <PhoneLink phone={c.phone} /> },
    { key: 'source', header: 'Source', render: (c) => cap(c.source) || '—' },
    { key: 'added', header: 'Added', render: (c) => fmtDate(c.created_at) },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (c) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          <button title="View" onClick={() => setViewRow(c)}>
            <Eye size={13} />
          </button>
          {canDelete && (
            <button
              className="danger"
              title="Delete"
              onClick={() => setDel({ kind: 'one', row: c })}
            >
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
          <h1 className="page-title">Customer</h1>
          <p className="page-subtitle">{stats.total} walk-in customer(s)</p>
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
              <Plus size={15} /> Add Customer
            </button>
          )}
        </div>
      </div>

      <StatCards
        items={[
          { key: 't', label: 'Total', value: stats.total, icon: UsersIcon },
          { key: 'm', label: 'This month', value: stats.month, icon: UserRound },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          resetPage()
        }}
        searchPlaceholder="Search name or contact..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <select
            className="filter-select"
            value={source}
            onChange={(e) => {
              setSource(e.target.value)
              resetPage()
            }}
          >
            <option value="all">Any source</option>
            {SOURCES.map((s) => (
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
              <input
                id="f-from"
                type="date"
                className="input"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value)
                  resetPage()
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="f-to">Added to</label>
              <input
                id="f-to"
                type="date"
                className="input"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value)
                  resetPage()
                }}
              />
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
        emptyLabel="No customers match these filters"
        selectable={canDelete}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        title="Customers"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {addOpen && (
        <CustomerModal
          mode="edit"
          initialPhone={sharedPhone}
          createdBy={profile?.id}
          onClose={() => {
            setAddOpen(false)
            setSharedPhone('')
            if (searchParams.toString()) setSearchParams({}, { replace: true })
          }}
          onDone={() => {
            setAddOpen(false)
            setSharedPhone('')
            if (searchParams.toString()) setSearchParams({}, { replace: true })
            fetchRows()
          }}
        />
      )}

      {viewRow && (
        <CustomerModal
          mode="view"
          row={viewRow}
          canEdit={canEdit}
          createdBy={profile?.id}
          onClose={() => setViewRow(null)}
          onDone={() => {
            setViewRow(null)
            fetchRows()
          }}
        />
      )}

      {importOpen && (
        <ImportModal
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
          title={del.kind === 'bulk' ? 'Delete customers' : 'Delete customer'}
          message={
            del.kind === 'bulk'
              ? `This permanently deletes ${del.ids.size} selected customer(s).`
              : `This permanently deletes ${del.row.full_name}.`
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
function CustomerModal({ mode: initialMode, row, canEdit, createdBy, initialPhone, onClose, onDone }) {
  const [mode, setMode] = useState(initialMode) // 'view' | 'edit'
  const editing = Boolean(row)

  const [form, setForm] = useState(
    row
      ? {
          full_name: row.full_name ?? '',
          phoneLocal: fromStored(row.phone),
          source: row.source ?? '',
          notes: row.notes ?? '',
        }
      : { ...EMPTY, phoneLocal: initialPhone || '' },
  )
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const phoneErr = pkPhoneError(form.phoneLocal)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!form.full_name.trim()) return setErr('Name is required')
    // phone is optional - only validate the format if something was typed
    if (form.phoneLocal && !isValidPkMobile(form.phoneLocal)) {
      return setErr(phoneErr || 'Enter a valid phone number or leave it blank')
    }

    const phone = form.phoneLocal ? toStored(form.phoneLocal) : null
    setBusy(true)

    // one customer per phone number (skip the check when there's no number)
    if (phone) {
      let dupeQ = supabase.from('customers').select('ref_no, full_name').eq('phone', phone)
      if (editing) dupeQ = dupeQ.neq('id', row.id)
      const { data: dupe } = await dupeQ.maybeSingle()
      if (dupe) {
        setBusy(false)
        return setErr(`A customer with this number already exists — #${dupe.ref_no} ${dupe.full_name}.`)
      }
    }

    const payload = {
      full_name: form.full_name.trim(),
      phone,
      source: form.source || null,
      notes: form.notes.trim() || null,
    }
    const q = editing
      ? supabase.from('customers').update(payload).eq('id', row.id)
      : supabase.from('customers').insert({ ...payload, created_by: createdBy })
    const { error } = await q
    setBusy(false)
    if (error) {
      return setErr(
        error.code === '23505'
          ? 'A customer with this number already exists.'
          : dbErrorMessage(error, 'customer'),
      )
    }
    toast.success(editing ? 'Customer updated' : 'Customer added')
    onDone()
  }

  const title = mode === 'view' ? row.full_name : editing ? 'Edit customer' : 'Add customer'

  if (mode === 'view') {
    return (
      <Modal open onClose={onClose} title={title} width={460}>
        <div>
          <ViewRow label="Customer ID" value={row.ref_no} />
          <ViewRow label="Customer name" value={row.full_name} />
          <ViewRow label="Contact no" value={<PhoneLink phone={row.phone} />} />
          <ViewRow label="Source" value={cap(row.source)} />
          <ViewRow label="Notes" value={row.notes} />
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
    <Modal open onClose={onClose} title={title} width={480}>
      <form className="modal-form" onSubmit={submit}>
        {err && <div className="modal-error">{err}</div>}

        <div className="field">
          <label htmlFor="c-name">Customer name *</label>
          <input
            id="c-name"
            className="input"
            value={form.full_name}
            onChange={(e) => set('full_name', e.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="c-phone">Contact no (optional)</label>
            <PkPhoneInput
              id="c-phone"
              value={form.phoneLocal}
              onChange={(v) => set('phoneLocal', v)}
              invalid={Boolean(form.phoneLocal) && Boolean(phoneErr)}
            />
            {form.phoneLocal && phoneErr && <span className="field-error">{phoneErr}</span>}
          </div>
          <div className="field">
            <label htmlFor="c-source">Source (optional)</label>
            <select
              id="c-source"
              className="select"
              value={form.source}
              onChange={(e) => set('source', e.target.value)}
            >
              <option value="">Select&hellip;</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {cap(s)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="c-notes">Notes (optional)</label>
          <textarea
            id="c-notes"
            className="textarea"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
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
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add customer'}
          </button>
        </div>
      </form>
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

function ImportModal({ createdBy, onClose, onDone }) {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const rows = parseCsv(await file.text())
    if (rows.length < 2) {
      toast.error('CSV has no data rows')
      return
    }
    const head = rows[0]
    const iName = pick(head, 'customer name', 'full name', 'name')
    const iPhone = pick(head, 'phone', 'contact', 'mobile')
    const iSource = pick(head, 'source')

    if (iName === -1) {
      toast.error('CSV needs a Name column')
      return
    }

    // phone numbers already in the system - skip those rows
    const { data: existing } = await supabase.from('customers').select('phone')
    const known = new Set((existing ?? []).map((c) => c.phone).filter(Boolean))

    const valid = []
    const skipped = []
    const seen = new Set()
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]
      const name = (row[iName] ?? '').trim()
      const rawPhone = iPhone === -1 ? '' : (row[iPhone] ?? '').trim()
      const local = toLocal(rawPhone)
      const src = iSource === -1 ? '' : (row[iSource] ?? '').trim().toLowerCase()

      if (!name) {
        skipped.push({ line: r + 1, reason: 'missing name' })
        continue
      }
      // phone is optional: blank is fine, a non-blank bad number is skipped
      let stored = null
      if (rawPhone) {
        if (!isValidPkMobile(local)) {
          skipped.push({ line: r + 1, reason: `invalid phone "${rawPhone}"` })
          continue
        }
        stored = toStored(local)
        if (known.has(stored) || seen.has(stored)) {
          skipped.push({ line: r + 1, reason: `customer with ${stored} already exists` })
          continue
        }
        seen.add(stored)
      }
      valid.push({
        full_name: name,
        phone: stored,
        source: SOURCES.includes(src) ? src : null,
        created_by: createdBy,
      })
    }
    setPreview({ valid, skipped })
  }

  const doImport = async () => {
    if (!preview?.valid.length) return
    setBusy(true)
    const { error } = await supabase.from('customers').insert(preview.valid)
    setBusy(false)
    if (error) {
      return toast.error(
        error.code === '23505'
          ? 'Some numbers are already registered — refresh and try again.'
          : dbErrorMessage(error, 'customer'),
      )
    }
    toast.success(`Imported ${preview.valid.length} customer(s)`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="Import customers" width={460}>
      <div className="modal-form">
        <p className="field-hint">
          CSV with a header row. Required: <b>Name</b>. Optional: <b>Phone</b>, <b>Source</b>.
          A phone, if given, is validated (10 digits, starts with 3); a bad one skips that row.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ghost btn-square"
            onClick={() => downloadCsv('customers_sample.csv', SAMPLE_CSV)}
          >
            <FileDown size={14} /> Download sample
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-square"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} /> Choose CSV file
          </button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />

        {preview && (
          <div className="import-summary">
            <div>
              <b>{preview.valid.length}</b> ready to import
            </div>
            {preview.skipped.length > 0 && (
              <>
                <div className="import-skip-head">{preview.skipped.length} row(s) skipped:</div>
                <ul className="import-skip-list">
                  {preview.skipped.slice(0, 8).map((s) => (
                    <li key={s.line}>
                      Line {s.line} — {s.reason}
                    </li>
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
          <button
            type="button"
            className="btn btn-square"
            onClick={doImport}
            disabled={busy || !preview?.valid.length}
          >
            {busy ? 'Importing…' : `Import ${preview?.valid.length || 0}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
