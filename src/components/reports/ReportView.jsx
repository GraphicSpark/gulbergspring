import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Download } from 'lucide-react'
import { DASH_RANGES, rangeWindow } from '../../lib/filters'
import { fmtMoney } from '../../lib/format'
import { downloadCsv, toCsv } from '../../lib/csv'
import DataTable from '../data/DataTable'
import FilterBar from '../data/FilterBar'
import StatCards from '../data/StatCards'

const AXIS = '#9aa0aa'
const GRID = '#eef0f3'
const tip = { border: '1px solid #e4e4e4', borderRadius: 10, fontSize: 12, padding: '6px 10px' }
const kfmt = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v))

function Chart({ chart }) {
  if (!chart || !chart.data?.length) return null
  const { type, data } = chart
  const common = { data, margin: { top: 6, right: 16, bottom: 0, left: 0 } }
  return (
    <div className="report-chart">
      <ResponsiveContainer width="100%" height={260}>
        {type === 'moneyTrend' ? (
          <AreaChart {...common}>
            <defs>
              <linearGradient id="rS" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3471b8" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#3471b8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="rN" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e874b" stopOpacity={0.24} />
                <stop offset="100%" stopColor="#1e874b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={44} tickFormatter={kfmt} />
            <Tooltip contentStyle={tip} formatter={(v) => fmtMoney(v)} />
            <Area type="monotone" dataKey="Sales" stroke="#3471b8" strokeWidth={2} fill="url(#rS)" />
            <Area type="monotone" dataKey="Net" stroke="#1e874b" strokeWidth={2} fill="url(#rN)" />
          </AreaChart>
        ) : type === 'salesOrders' ? (
          <ComposedChart {...common}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis yAxisId="l" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={44} tickFormatter={kfmt} />
            <YAxis yAxisId="r" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={tip} formatter={(v, n) => (n === 'Sales' ? fmtMoney(v) : v)} />
            <Bar yAxisId="r" dataKey="Orders" fill="#dbe6f3" radius={[3, 3, 0, 0]} barSize={16} />
            <Line yAxisId="l" type="monotone" dataKey="Sales" stroke="#3471b8" strokeWidth={2} dot={false} />
          </ComposedChart>
        ) : type === 'statusBars' ? (
          <BarChart {...common}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={tip} />
            <Bar dataKey="Confirmed" stackId="s" fill="#1e874b" barSize={20} />
            <Bar dataKey="Pending" stackId="s" fill="#b7791f" barSize={20} />
            <Bar dataKey="Cancelled" stackId="s" fill="#c0392b" barSize={20} radius={[3, 3, 0, 0]} />
          </BarChart>
        ) : type === 'cashflow' ? (
          <ComposedChart {...common}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={44} tickFormatter={kfmt} />
            <Tooltip contentStyle={tip} formatter={(v) => fmtMoney(v)} />
            <Bar dataKey="In" fill="#1e874b" radius={[3, 3, 0, 0]} barSize={14} />
            <Bar dataKey="Out" fill="#b7791f" radius={[3, 3, 0, 0]} barSize={14} />
            <Line type="monotone" dataKey="Balance" stroke="#3471b8" strokeWidth={2} dot={false} />
          </ComposedChart>
        ) : (
          <div />
        )}
      </ResponsiveContainer>
    </div>
  )
}

export default function ReportView({ report, data }) {
  const [rangeKey, setRangeKey] = useState('all')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [search, setSearch] = useState('')

  const win = useMemo(() => rangeWindow(rangeKey, custom), [rangeKey, custom])
  const built = useMemo(
    () => report.build({ ...data, from: win.from, to: win.to }),
    [report, data, win.from, win.to],
  )

  // DataTable needs each column to carry a `render`; our report columns are plain
  // { key, header, align } so default to the row's raw value.
  const tableColumns = useMemo(
    () => built.columns.map((c) => ({ ...c, render: c.render ?? ((r) => r[c.key]) })),
    [built.columns],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return built.rows
    return built.rows.filter((r) =>
      built.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)),
    )
  }, [built, search])

  const exportCsv = () => {
    const headers = built.columns.map((c) => ({ key: c.key, label: c.header }))
    downloadCsv(
      `${built.filename}_${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(headers, built.rows),
    )
    toast.success(`Exported ${built.rows.length} row(s)`)
  }

  return (
    <div className="report-view">
      <div className="report-head">
        <div>
          <h2>{report.label}</h2>
          <p>{report.subtitle}</p>
        </div>
        <button className="btn btn-ghost btn-square btn-sm" onClick={exportCsv}>
          <Download size={14} /> Export
        </button>
      </div>

      <div className="report-range">
        <div className="range-tabs" role="tablist">
          {DASH_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              role="tab"
              aria-selected={rangeKey === r.key}
              className={`range-tab${rangeKey === r.key ? ' active' : ''}`}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === 'custom' && (
          <div className="report-range-custom">
            <input
              type="date"
              className="input"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            />
            <span>to</span>
            <input
              type="date"
              className="input"
              value={custom.to}
              min={custom.from || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            />
          </div>
        )}
      </div>

      <StatCards items={built.kpis} />

      <Chart chart={built.chart} />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search rows..."
        activeCount={0}
        onClear={() => setSearch('')}
      />

      <DataTable
        dense
        columns={tableColumns}
        rows={rows}
        rowKey={(r) => r.id ?? r.month ?? r.package ?? r.customer ?? r.agent ?? r.client}
        rowClassName={(r) => (r._total ? 'row-total' : '')}
        emptyLabel="No data for this period"
        title={report.label}
        subtitle={`${rows.length} row(s)`}
      />
    </div>
  )
}
