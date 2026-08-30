import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Coins, Download, PackageOpen, RefreshCw, TrendingUp, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtMoney } from '../lib/format'
import { LEDGER_SELECT, lineClientCut } from '../lib/ledger'
import { rangeFrom } from '../lib/filters'
import { downloadCsv, toCsv } from '../lib/csv'
import RangeTabs from '../components/RangeTabs'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import StatCards from '../components/data/StatCards'

// Per-package view: confirmed orders are EXPLODED into their line items and
// grouped by package name. Sales / Client cut / GS gross come straight off each
// line. Agent cut and Net are order-level (not attributable to one package) so
// they are not shown here - use the Financial / Account / Agent ledgers for those.
export default function PackagePerformance() {
  const { can } = useAuth()
  const canView = can('performance', 'view')

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(LEDGER_SELECT)
      .eq('status', 'confirmed')
    if (error) toast.error('Could not load the ledger')
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const groups = useMemo(() => {
    const rFrom = rangeFrom(range)
    const map = new Map()
    for (const o of orders) {
      const d = o.confirmed_at || o.created_at
      if (rFrom && d < rFrom) continue
      if (from && d < from) continue
      if (to && d > `${to}T23:59:59`) continue
      const items = o.order_items?.length
        ? o.order_items
        : [{ package_name: o.package_name || o.service || '—', line_total: o.list_amount ?? o.amount, client_kind: o.client_kind, client_value: o.client_value, qty: 1 }]
      for (const it of items) {
        const name = it.package_name || '—'
        const cur = map.get(name) ?? { name, orders: new Set(), qty: 0, sales: 0, client: 0 }
        cur.orders.add(o.id)
        cur.qty += Number(it.qty) || 1
        cur.sales += Number(it.line_total) || 0
        cur.client += lineClientCut(it)
        map.set(name, cur)
      }
    }
    let list = [...map.values()].map((g) => ({
      id: g.name,
      label: g.name,
      orders: g.orders.size,
      qty: g.qty,
      sales: g.sales,
      client: g.client,
      gsGross: g.sales - g.client,
    }))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((g) => g.label.toLowerCase().includes(q))
    return list.sort((a, b) => b.sales - a.sales)
  }, [orders, range, from, to, search])

  const grand = useMemo(
    () =>
      groups.reduce(
        (a, g) => ({
          orders: a.orders + g.orders,
          qty: a.qty + g.qty,
          sales: a.sales + g.sales,
          client: a.client + g.client,
          gsGross: a.gsGross + g.gsGross,
        }),
        { orders: 0, qty: 0, sales: 0, client: 0, gsGross: 0 },
      ),
    [groups],
  )

  const activeFilters = (from ? 1 : 0) + (to ? 1 : 0)
  const clearFilters = () => {
    setFrom('')
    setTo('')
    setSearch('')
    setRange('all')
  }

  const exportCsv = () => {
    const headers = [
      { key: 'label', label: 'Package' },
      { key: 'orders', label: 'Orders' },
      { key: 'qty', label: 'Qty sold' },
      { key: 'sales', label: 'Sales' },
      { key: 'client', label: 'Client cut' },
      { key: 'gsGross', label: 'GS gross' },
    ]
    const line = (g) => ({
      label: g.label,
      orders: g.orders,
      qty: g.qty,
      sales: fmtMoney(g.sales),
      client: fmtMoney(g.client),
      gsGross: fmtMoney(g.gsGross),
    })
    const rows = groups.map(line)
    rows.push(line({ ...grand, label: 'TOTAL' }))
    downloadCsv(`package_performance_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows))
    toast.success(`Exported ${groups.length} package(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <PackageOpen size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the Finance section.</p>
        </div>
      </div>
    )
  }

  const columns = [
    {
      key: 'label',
      header: 'Package',
      render: (g) => <span className="primary">{g.label}</span>,
    },
    { key: 'orders', header: 'Orders', align: 'right', render: (g) => g.orders },
    { key: 'qty', header: 'Qty sold', align: 'right', render: (g) => g.qty },
    { key: 'sales', header: 'Sales', align: 'right', render: (g) => fmtMoney(g.sales) },
    { key: 'client', header: 'Client cut', align: 'right', render: (g) => fmtMoney(g.client) },
    {
      key: 'gsGross',
      header: 'GS gross',
      align: 'right',
      render: (g) => <b style={{ color: 'var(--accent)' }}>{fmtMoney(g.gsGross)}</b>,
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Package Performance</h1>
          <p className="page-subtitle">
            {groups.length} package(s) · {grand.orders} confirmed order(s) · line-level Sales /
            Client cut / GS gross (Agent &amp; Net are order-level)
          </p>
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

      <RangeTabs value={range} onChange={setRange} />

      <StatCards
        items={[
          { key: 's', label: 'Sales', value: fmtMoney(grand.sales), icon: TrendingUp },
          { key: 'c', label: 'Client cut', value: fmtMoney(grand.client), icon: Users },
          { key: 'gg', label: 'GS gross', value: fmtMoney(grand.gsGross), icon: Coins },
          { key: 'q', label: 'Qty sold', value: grand.qty, icon: PackageOpen },
        ]}
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search package..."
        activeCount={activeFilters}
        onClear={clearFilters}
        advanced={
          <>
            <div className="field">
              <label htmlFor="f-from">From</label>
              <input id="f-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="f-to">To</label>
              <input id="f-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        }
      />

      <DataTable
        dense
        columns={columns}
        rows={groups}
        rowKey={(g) => g.id}
        loading={loading}
        emptyLabel="No confirmed orders in this period"
        title="Packages"
        subtitle={`${groups.length} · GS gross ${fmtMoney(grand.gsGross)}`}
      />
    </div>
  )
}
