import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Coins, Download, ReceiptText, RefreshCw, Tag, TrendingUp, Users, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate, fmtMoney } from '../lib/format'
import { LEDGER_SELECT, ZERO_TOTALS, addTotals, ledgerAmounts, packageSummary } from '../lib/ledger'
import { rangeFrom } from '../lib/filters'
import { downloadCsv, toCsv } from '../lib/csv'
import RangeTabs from '../components/RangeTabs'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import Pagination from '../components/data/Pagination'
import SearchSelect from '../components/SearchSelect'
import StatCards from '../components/data/StatCards'

const PAGE_SIZE = 20

export default function FinancialLedger() {
  const { can } = useAuth()
  const canView = can('finance', 'view')

  const [rows, setRows] = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  const [search, setSearch] = useState('')
  const [range, setRange] = useState('all')
  const [accountF, setAccountF] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [lossOnly, setLossOnly] = useState(false)

  const fetchRows = useCallback(async () => {
    const [{ data, error }, ac] = await Promise.all([
      supabase
        .from('orders')
        .select(LEDGER_SELECT)
        .eq('status', 'confirmed')
        .order('confirmed_at', { ascending: false }),
      supabase.from('accounts').select('id, ref_no, name').order('name'),
    ])
    if (error) toast.error('Could not load the ledger')
    setRows(data ?? [])
    setAccounts(ac.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rFrom = rangeFrom(range)
    return rows.filter((o) => {
      if (accountF !== 'all' && (o.account?.id ?? 'none') !== accountF) return false
      if (lossOnly && ledgerAmounts(o).net >= 0) return false
      const d = o.confirmed_at || o.created_at
      if (rFrom && d < rFrom) return false
      if (from && d < from) return false
      if (to && d > `${to}T23:59:59`) return false
      if (q) {
        const hay = `${o.ref_no} ${o.account?.name ?? ''} ${o.customer?.full_name ?? ''} ${o.client?.company_name ?? ''} ${packageSummary(o)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, range, accountF, from, to, lossOnly])

  const totals = useMemo(() => filtered.reduce(addTotals, ZERO_TOTALS), [filtered])

  const activeFilters =
    (accountF !== 'all' ? 1 : 0) + (from ? 1 : 0) + (to ? 1 : 0) + (lossOnly ? 1 : 0)
  const resetPage = () => setPage(1)
  const clearFilters = () => {
    setAccountF('all')
    setFrom('')
    setTo('')
    setSearch('')
    setLossOnly(false)
    setRange('all')
    setPage(1)
  }
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const exportCsv = () => {
    const headers = [
      { key: 'id', label: 'Order ID' },
      { key: 'date', label: 'Date' },
      { key: 'account', label: 'Account' },
      { key: 'customer', label: 'Customer' },
      { key: 'client', label: 'Client' },
      { key: 'package', label: 'Package' },
      { key: 'agent', label: 'Agent' },
      { key: 'sales', label: 'Sales' },
      { key: 'client_cut', label: 'Client cut' },
      { key: 'gs_gross', label: 'GS gross' },
      { key: 'discount', label: 'Discount' },
      { key: 'gs_net', label: 'GS net (client owes us)' },
      { key: 'agent_cut', label: 'Agent cut' },
      { key: 'net', label: 'Net' },
    ]
    const data = filtered.map((o) => {
      const a = ledgerAmounts(o)
      return {
        id: o.ref_no,
        date: fmtDate(o.confirmed_at || o.created_at),
        account: o.account?.name ?? '—',
        customer: o.customer?.full_name ?? '',
        client: o.client?.company_name ?? '',
        package: packageSummary(o),
        agent: o.agent?.full_name ?? '',
        sales: fmtMoney(a.sales),
        client_cut: fmtMoney(a.client),
        gs_gross: fmtMoney(a.gsGross),
        discount: fmtMoney(a.discount),
        gs_net: fmtMoney(a.gsNet),
        agent_cut: fmtMoney(a.agent),
        net: fmtMoney(a.net),
      }
    })
    downloadCsv(`financial_ledger_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, data))
    toast.success(`Exported ${data.length} transaction(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <ReceiptText size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the Finance section.</p>
        </div>
      </div>
    )
  }

  const money = (v) => <span className="primary">{fmtMoney(v)}</span>

  const columns = [
    { key: 'ref', header: 'Order', render: (o) => o.ref_no },
    { key: 'date', header: 'Date', render: (o) => fmtDate(o.confirmed_at || o.created_at) },
    { key: 'account', header: 'Account', render: (o) => o.account?.name ?? '—' },
    { key: 'customer', header: 'Customer', render: (o) => o.customer?.full_name ?? '—' },
    { key: 'clientco', header: 'Client', render: (o) => o.client?.company_name ?? '—' },
    { key: 'package', header: 'Packages', render: (o) => packageSummary(o) },
    { key: 'agent', header: 'Agent', render: (o) => o.agent?.full_name ?? '—' },
    { key: 'sales', header: 'Sales', align: 'right', render: (o) => fmtMoney(ledgerAmounts(o).sales) },
    { key: 'clientcut', header: 'Client cut', align: 'right', render: (o) => fmtMoney(ledgerAmounts(o).client) },
    { key: 'gsgross', header: 'GS gross', align: 'right', render: (o) => fmtMoney(ledgerAmounts(o).gsGross) },
    { key: 'discount', header: 'Discount', align: 'right', render: (o) => fmtMoney(ledgerAmounts(o).discount) },
    { key: 'gsnet', header: 'GS net', align: 'right', render: (o) => money(ledgerAmounts(o).gsNet) },
    { key: 'agentcut', header: 'Agent cut', align: 'right', render: (o) => fmtMoney(ledgerAmounts(o).agent) },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      render: (o) => {
        const n = ledgerAmounts(o).net
        return <b style={{ color: n < 0 ? 'var(--danger)' : 'var(--accent)' }}>{fmtMoney(n)}</b>
      },
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Financial Ledger</h1>
          <p className="page-subtitle">{totals.orders} confirmed order(s)</p>
        </div>
        <div className="page-actions">
          <button className="icon-btn" onClick={fetchRows} title="Refresh">
            <RefreshCw size={15} />
          </button>
          <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <RangeTabs value={range} onChange={(v) => { setRange(v); resetPage() }} />

      <StatCards
        items={[
          { key: 's', label: 'Sales', value: fmtMoney(totals.sales), icon: TrendingUp },
          { key: 'cc', label: 'Client cut', value: fmtMoney(totals.client), icon: Users },
          { key: 'gg', label: 'GS gross', value: fmtMoney(totals.gsGross), icon: Coins },
          { key: 'd', label: 'Discount', value: fmtMoney(totals.discount), icon: Tag },
          { key: 'gn', label: 'GS net (owed by clients)', value: fmtMoney(totals.gsNet), icon: Wallet },
          { key: 'a', label: 'Agent payable', value: fmtMoney(totals.agent), icon: Users },
          { key: 'n', label: 'Net', value: fmtMoney(totals.net), icon: Wallet },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          resetPage()
        }}
        searchPlaceholder="Search order, account, customer, client..."
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <>
            <div style={{ minWidth: 200 }}>
              <SearchSelect
                value={accountF}
                onChange={(v) => {
                  setAccountF(v || 'all')
                  resetPage()
                }}
                placeholder="Any account"
                options={[
                  { value: 'all', label: 'Any account' },
                  ...accounts.map((a) => ({ value: a.id, label: a.name, sub: String(a.ref_no) })),
                ]}
              />
            </div>
            <label className="check-line">
              <input
                type="checkbox"
                checked={lossOnly}
                onChange={(e) => { setLossOnly(e.target.checked); resetPage() }}
              />
              Losses only
            </label>
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
          </>
        }
      />

      <DataTable
        dense
        columns={columns}
        rows={pageRows}
        rowKey={(o) => o.id}
        rowClassName={(o) => (ledgerAmounts(o).net < 0 ? 'row-loss' : '')}
        loading={loading}
        emptyLabel="No confirmed orders match these filters"
        title="Transactions"
        subtitle={`${filtered.length} shown`}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPage={setPage} />
    </div>
  )
}
