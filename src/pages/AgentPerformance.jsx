import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Award,
  BadgeCheck,
  Coins,
  Download,
  Percent,
  RefreshCw,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtMoney } from '../lib/format'
import { ledgerAmounts } from '../lib/ledger'
import { rangeFrom } from '../lib/filters'
import { downloadCsv, toCsv } from '../lib/csv'
import RangeTabs from '../components/RangeTabs'
import DataTable from '../components/data/DataTable'
import FilterBar from '../components/data/FilterBar'
import StatCards from '../components/data/StatCards'
import './agent-performance.css'

const SELECT = `
  id, status, created_at, confirmed_at,
  list_amount, amount, discount_kind, discount_value,
  client_kind, client_value, client_amount,
  agent_kind, agent_value, agent_amount, company_amount,
  agent:agent_id ( id, full_name ),
  order_items ( qty )
`

const AXIS = '#9aa0aa'
const GRID = '#eef0f3'
const tipStyle = { border: '1px solid #e4e4e4', borderRadius: 10, fontSize: 12, padding: '6px 10px' }
const kfmt = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v))
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0)

const METRICS = [
  { key: 'net', label: 'Company net', fmt: fmtMoney },
  { key: 'commission', label: 'Commission', fmt: fmtMoney },
  { key: 'sales', label: 'Sales', fmt: fmtMoney },
  { key: 'confirmed', label: 'Orders', fmt: (v) => v },
]

export default function AgentPerformance() {
  const { can } = useAuth()
  const canView = can('performance', 'view')

  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [metric, setMetric] = useState('net')

  const fetchRows = useCallback(async () => {
    const { data, error } = await supabase.from('orders').select(SELECT)
    if (error) toast.error('Could not load orders')
    setOrders(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const rows = useMemo(() => {
    const rFrom = rangeFrom(range)
    const inRange = (o) => {
      const d = (o.status === 'confirmed' ? o.confirmed_at : o.created_at) || o.created_at
      if (rFrom && d < rFrom) return false
      if (from && d < from) return false
      if (to && d > `${to}T23:59:59`) return false
      return true
    }
    const map = new Map()
    for (const o of orders) {
      if (!o.agent) continue
      if (!inRange(o)) continue
      const g =
        map.get(o.agent.id) ??
        {
          id: o.agent.id,
          name: o.agent.full_name || '—',
          total: 0,
          pending: 0,
          confirmed: 0,
          cancelled: 0,
          units: 0,
          sales: 0,
          gsNet: 0,
          commission: 0,
          net: 0,
        }
      g.total += 1
      if (o.status === 'pending') g.pending += 1
      else if (o.status === 'cancelled') g.cancelled += 1
      else if (o.status === 'confirmed') {
        g.confirmed += 1
        const a = ledgerAmounts(o)
        g.sales += a.sales
        g.gsNet += a.gsNet
        g.commission += a.agent
        g.net += a.net
        g.units += (o.order_items ?? []).reduce((s, it) => s + (Number(it.qty) || 1), 0)
      }
      map.set(o.agent.id, g)
    }
    let list = [...map.values()].map((g) => ({
      ...g,
      conversion: pct(g.confirmed, g.confirmed + g.cancelled),
      aov: g.confirmed ? g.sales / g.confirmed : 0,
    }))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q))
    return list.sort((a, b) => b[metric] - a[metric] || b.net - a.net)
  }, [orders, range, from, to, search, metric])

  const grand = useMemo(
    () =>
      rows.reduce(
        (a, g) => ({
          agents: a.agents + 1,
          total: a.total + g.total,
          confirmed: a.confirmed + g.confirmed,
          cancelled: a.cancelled + g.cancelled,
          sales: a.sales + g.sales,
          gsNet: a.gsNet + g.gsNet,
          commission: a.commission + g.commission,
          net: a.net + g.net,
        }),
        { agents: 0, total: 0, confirmed: 0, cancelled: 0, sales: 0, gsNet: 0, commission: 0, net: 0 },
      ),
    [rows],
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
      { key: 'name', label: 'Agent' },
      { key: 'total', label: 'Orders' },
      { key: 'confirmed', label: 'Confirmed' },
      { key: 'cancelled', label: 'Cancelled' },
      { key: 'conversion', label: 'Conversion %' },
      { key: 'units', label: 'Packages sold' },
      { key: 'sales', label: 'Sales' },
      { key: 'gsNet', label: 'GS net' },
      { key: 'commission', label: 'Commission earned' },
      { key: 'net', label: 'Company net' },
      { key: 'aov', label: 'Avg order value' },
    ]
    const line = (g) => ({
      name: g.name,
      total: g.total,
      confirmed: g.confirmed,
      cancelled: g.cancelled,
      conversion: `${g.conversion}%`,
      units: g.units,
      sales: fmtMoney(g.sales),
      gsNet: fmtMoney(g.gsNet),
      commission: fmtMoney(g.commission),
      net: fmtMoney(g.net),
      aov: fmtMoney(g.aov),
    })
    const data = rows.map(line)
    data.push({
      ...line({ ...grand, name: 'TOTAL', units: 0, aov: 0, conversion: pct(grand.confirmed, grand.confirmed + grand.cancelled) }),
    })
    downloadCsv(`agent_performance_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, data))
    toast.success(`Exported ${rows.length} agent(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <UserCog size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the Performance section.</p>
        </div>
      </div>
    )
  }

  const activeMetric = METRICS.find((m) => m.key === metric)
  const chartData = rows.slice(0, 10).map((g) => ({ name: g.name.split(' ')[0], value: g[metric] }))
  const statusData = rows.slice(0, 10).map((g) => ({
    name: g.name.split(' ')[0],
    Confirmed: g.confirmed,
    Pending: g.pending,
    Cancelled: g.cancelled,
  }))

  const columns = [
    { key: 'name', header: 'Agent', render: (g) => <span className="primary">{g.name}</span> },
    { key: 'total', header: 'Orders', align: 'right', render: (g) => g.total },
    { key: 'confirmed', header: 'Confirmed', align: 'right', render: (g) => g.confirmed },
    {
      key: 'conversion',
      header: 'Conv.',
      align: 'right',
      render: (g) => (
        <b style={{ color: g.conversion >= 60 ? 'var(--success)' : g.conversion >= 30 ? 'var(--warning)' : 'var(--danger)' }}>
          {g.conversion}%
        </b>
      ),
    },
    { key: 'units', header: 'Pkgs', align: 'right', render: (g) => g.units },
    { key: 'sales', header: 'Sales', align: 'right', render: (g) => fmtMoney(g.sales) },
    { key: 'gsNet', header: 'GS net', align: 'right', render: (g) => fmtMoney(g.gsNet) },
    { key: 'commission', header: 'Commission', align: 'right', render: (g) => fmtMoney(g.commission) },
    { key: 'aov', header: 'Avg order', align: 'right', render: (g) => fmtMoney(g.aov) },
    {
      key: 'net',
      header: 'Company net',
      align: 'right',
      render: (g) => <b style={{ color: 'var(--accent)' }}>{fmtMoney(g.net)}</b>,
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Agent Performance</h1>
          <p className="page-subtitle">
            {grand.agents} agent(s) · {grand.confirmed} confirmed / {grand.total} order(s)
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
          { key: 'ag', label: 'Agents', value: grand.agents, icon: Users },
          { key: 'o', label: 'Orders', value: grand.total, icon: BadgeCheck },
          { key: 'cv', label: 'Conversion', value: `${pct(grand.confirmed, grand.confirmed + grand.cancelled)}%`, icon: Percent },
          { key: 's', label: 'Sales', value: fmtMoney(grand.sales), icon: TrendingUp },
          { key: 'gn', label: 'GS net', value: fmtMoney(grand.gsNet), icon: Coins },
          { key: 'com', label: 'Commission paid', value: fmtMoney(grand.commission), icon: Wallet },
          { key: 'net', label: 'Company net', value: fmtMoney(grand.net), icon: Award },
        ]}
      />

      <div className="ap-charts">
        <div className="ap-panel">
          <div className="ap-panel-head">
            <h3>Leaderboard</h3>
            <div className="ap-metric-switch">
              {METRICS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={metric === m.key ? 'on' : ''}
                  onClick={() => setMetric(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {chartData.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} tickFormatter={activeMetric.key === 'confirmed' ? undefined : kfmt} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tipStyle} formatter={(v) => activeMetric.fmt(v)} />
                <Bar dataKey="value" name={activeMetric.label} radius={[0, 4, 4, 0]} barSize={18}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#3471b8' : '#9cc0e6'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="ap-empty">No agent activity in this period</p>
          )}
        </div>

        <div className="ap-panel">
          <div className="ap-panel-head">
            <h3>Orders by status</h3>
            <span className="ap-sub">per agent</span>
          </div>
          {statusData.length ? (
            <ResponsiveContainer width="100%" height={Math.max(160, statusData.length * 34)}>
              <BarChart data={statusData} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tipStyle} />
                <Bar dataKey="Confirmed" stackId="s" fill="#1e874b" barSize={18} />
                <Bar dataKey="Pending" stackId="s" fill="#b7791f" barSize={18} />
                <Bar dataKey="Cancelled" stackId="s" fill="#c0392b" barSize={18} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="ap-empty">No agent activity in this period</p>
          )}
          <div className="ap-legend">
            <span><i style={{ background: '#1e874b' }} />Confirmed</span>
            <span><i style={{ background: '#b7791f' }} />Pending</span>
            <span><i style={{ background: '#c0392b' }} />Cancelled</span>
          </div>
        </div>
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search agent..."
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
        rows={rows}
        rowKey={(g) => g.id}
        loading={loading}
        emptyLabel="No agent activity in this period"
        title="Agents"
        subtitle={`${rows.length} · company net ${fmtMoney(grand.net)}`}
      />
    </div>
  )
}
