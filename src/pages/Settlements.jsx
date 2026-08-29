import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowDownLeft, ArrowUpRight, HandCoins, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate, fmtMoney } from '../lib/format'
import { dbErrorMessage } from '../lib/errors'
import { rangeFrom } from '../lib/filters'
import RangeTabs from '../components/RangeTabs'
import ConfirmDelete from '../components/ConfirmDelete'
import SettlementModal from '../components/SettlementModal'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 20
const SELECT = 'id, ref_no, party, client_id, agent_id, amount, paid_on, method, note, client:client_id ( ref_no, company_name ), agent:agent_id ( full_name )'

// party 'client' = money IN  (the client pays us what they owe)
// party 'agent'  = money OUT (we pay the agent their cut)
export default function Settlements() {
  const { can, profile } = useAuth()
  const canView = can('finance', 'view')
  const canAdd = can('finance', 'add')
  const canEdit = can('finance', 'edit')
  const canDelete = can('finance', 'delete')

  const [rows, setRows] = useState([])
  const [clients, setClients] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [range, setRange] = useState('all')
  const [partyF, setPartyF] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [edit, setEdit] = useState(null) // row | 'new' | null
  const [del, setDel] = useState(null)
  const [delBusy, setDelBusy] = useState(false)

  const fetchRows = useCallback(async () => {
    const [{ data, error }, cl, ag] = await Promise.all([
      supabase.from('payouts').select(SELECT).order('paid_on', { ascending: false }),
      supabase.from('clients').select('id, ref_no, company_name').order('company_name'),
      supabase.from('profiles').select('id, full_name').eq('is_active', true).order('full_name'),
    ])
    if (error) toast.error('Could not load settlements')
    setRows(data ?? [])
    setClients(cl.data ?? [])
    setAgents(ag.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rFrom = rangeFrom(range)
    return rows.filter((p) => {
      if (partyF !== 'all' && p.party !== partyF) return false
      if (rFrom && p.paid_on < rFrom) return false
      if (from && p.paid_on < from) return false
      if (to && p.paid_on > to) return false
      if (q) {
        const name = p.party === 'client' ? p.client?.company_name : p.agent?.full_name
        if (!`${p.ref_no} ${name ?? ''} ${p.method ?? ''} ${p.note ?? ''}`.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [rows, search, range, partyF, from, to])

  const stats = useMemo(() => {
    let inFromClients = 0
    let outToAgents = 0
    for (const p of filtered) {
      if (p.party === 'client') inFromClients += Number(p.amount)
      else outToAgents += Number(p.amount)
    }
    return { inFromClients, outToAgents, net: inFromClients - outToAgents }
  }, [filtered])

  const activeFilters = (partyF !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0)
  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setPartyF('all')
    setFrom('')
    setTo('')
    setSearch('')
    setRange('all')
    setPage(1)
  }
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const doDelete = async () => {
    if (!del) return
    setDelBusy(true)
    const { error } = await supabase.from('payouts').delete().eq('id', del.id)
    setDelBusy(false)
    if (error) return toast.error(dbErrorMessage(error, 'settlement'))
    toast.success('Settlement deleted')
    setDel(null)
    fetchRows()
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <HandCoins size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the Finance section.</p>
        </div>
      </div>
    )
  }

  const nameOf = (p) => (p.party === 'client' ? p.client?.company_name : p.agent?.full_name) ?? '—'

  const columns = [
    { key: 'ref', header: 'ID', render: (p) => p.ref_no },
    { key: 'date', header: 'Date', render: (p) => fmtDate(p.paid_on) },
    {
      key: 'party',
      header: 'Party',
      render: (p) => (
        <div className="stack">
          <span className="primary">{nameOf(p)}</span>
          <span className="secondary">
            {p.party === 'client' ? 'Client — paid us' : 'Agent — we paid'}
          </span>
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (p) => (
        <b style={{ color: p.party === 'client' ? 'var(--success)' : 'var(--danger)' }}>
          {p.party === 'client' ? '+' : '−'} {fmtMoney(p.amount)}
        </b>
      ),
    },
    { key: 'method', header: 'Method', render: (p) => p.method || '—' },
    { key: 'note', header: 'Note', render: (p) => p.note || '—' },
    {
      key: 'action',
      header: 'Action',
      align: 'right',
      render: (p) => (
        <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
          {canEdit && (
            <button title="Edit" onClick={() => setEdit(p)}>
              <Pencil size={13} />
            </button>
          )}
          {canDelete && (
            <button className="danger" title="Delete" onClick={() => setDel(p)}>
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
          <h1 className="page-title">Settlements</h1>
          <p className="page-subtitle">Money collected from clients &amp; paid to agents</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          {canAdd && (
            <button className="btn" onClick={() => setEdit('new')}>
              <Plus size={15} /> Record settlement
            </button>
          )}
        </div>
      </div>

      <RangeTabs value={range} onChange={(v) => { setRange(v); resetPage() }} />

      <StatCards
        items={[
          { key: 'in', label: 'Received from clients', value: fmtMoney(stats.inFromClients), icon: ArrowDownLeft },
          { key: 'out', label: 'Paid to agents', value: fmtMoney(stats.outToAgents), icon: ArrowUpRight },
          { key: 'net', label: 'Net cash movement', value: fmtMoney(stats.net), icon: HandCoins },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => { setSearch(v); resetPage() }}
        searchPlaceholder="Search name, method or note..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <select className="filter-select" value={partyF} onChange={(e) => { setPartyF(e.target.value); resetPage() }}>
            <option value="all">All settlements</option>
            <option value="client">From clients (money in)</option>
            <option value="agent">To agents (money out)</option>
          </select>
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
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={pageRows}
        rowKey={(p) => p.id}
        loading={loading}
        emptyLabel="No settlements recorded yet"
        title="Settlements"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />

      {edit && (
        <SettlementModal
          row={edit === 'new' ? null : edit}
          clients={clients}
          agents={agents}
          createdBy={profile?.id}
          onClose={() => setEdit(null)}
          onDone={() => {
            setEdit(null)
            fetchRows()
          }}
        />
      )}

      {del && (
        <ConfirmDelete
          open
          title="Delete settlement"
          message={`This permanently deletes the ${fmtMoney(del.amount)} settlement with ${nameOf(del)}.`}
          busy={delBusy}
          onConfirm={doDelete}
          onClose={() => setDel(null)}
        />
      )}
    </div>
  )
}

