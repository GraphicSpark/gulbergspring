import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CalendarClock,
  ClipboardList,
  Coins,
  HandCoins,
  Minus,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtDate, fmtMoney } from '../lib/format'
import { slotLabel } from '../lib/slots'
import { DASH_RANGES, rangeWindow } from '../lib/filters'
import { buildDashboard } from '../lib/dashboard'
import { ledgerAmounts } from '../lib/ledger'
import './dashboard.css'

const ORDER_SELECT = `
  id, ref_no, status, amount, list_amount, discount_kind, discount_value,
  client_amount, agent_amount, company_amount, created_at, confirmed_at,
  scheduled_date, scheduled_time, package_name, service, customer_id,
  account:account_id ( id, name ),
  client:client_id ( id, company_name ),
  customer:customer_id ( full_name ),
  agent:agent_id ( id, full_name )
`

const AXIS = '#9aa0aa'
const GRID = '#eef0f3'
const money0 = (v) => `Rs ${Math.round(Number(v) || 0).toLocaleString('en-PK')}`
const kfmt = (v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : Math.round(v))

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const tipStyle = {
  border: '1px solid #e4e4e4',
  borderRadius: 10,
  fontSize: 12,
  padding: '7px 10px',
  boxShadow: '0 8px 24px rgba(16,24,40,0.12)',
}

// ── range control ────────────────────────────────────────────────────────
function DashRange({ rangeKey, onKey, custom, onCustom }) {
  return (
    <div className="dash-range">
      <div className="range-tabs" role="tablist">
        {DASH_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={rangeKey === r.key}
            className={`range-tab${rangeKey === r.key ? ' active' : ''}`}
            onClick={() => onKey(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {rangeKey === 'custom' && (
        <div className="dash-range-custom">
          <input
            type="date"
            className="input"
            value={custom.from}
            max={custom.to || undefined}
            onChange={(e) => onCustom({ ...custom, from: e.target.value })}
          />
          <span>to</span>
          <input
            type="date"
            className="input"
            value={custom.to}
            min={custom.from || undefined}
            onChange={(e) => onCustom({ ...custom, to: e.target.value })}
          />
        </div>
      )}
    </div>
  )
}

// ── KPI card ─────────────────────────────────────────────────────────────
function Kpi({ label, value, delta, prevLabel, spark, sparkColor = '#3471b8', icon: Icon }) {
  const dir = delta == null ? null : delta > 0.5 ? 'up' : delta < -0.5 ? 'down' : 'flat'
  const Chip = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {Icon && <Icon size={15} className="kpi-ico" strokeWidth={1.75} />}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        {dir && (
          <span className={`kpi-delta ${dir}`}>
            <Chip size={12} />
            {Math.abs(delta) >= 999 ? '999+' : Math.round(Math.abs(delta))}%
          </span>
        )}
        {prevLabel && dir && <span className="kpi-prev">vs {prevLabel}</span>}
        {spark && spark.length > 1 && (
          <span className="kpi-spark">
            <ResponsiveContainer width="100%" height={26}>
              <AreaChart data={spark} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
                <defs>
                  <linearGradient id={`sp-${label}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} fill={`url(#sp-${label})`} />
              </AreaChart>
            </ResponsiveContainer>
          </span>
        )}
      </div>
    </div>
  )
}

function Panel({ title, sub, right, children }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {sub != null && <span className="panel-sub">{sub}</span>}
        {right}
      </div>
      {children}
    </div>
  )
}

function MiniBar({ data, color, valueFmt }) {
  if (!data.length) return <p className="dash-empty">No data</p>
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 44, top: 2, bottom: 2 }}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5, fill: '#5b616b' }} tickLine={false} axisLine={false} width={116} />
        <Tooltip contentStyle={tipStyle} cursor={{ fill: 'rgba(52,113,184,0.06)' }} formatter={(v) => (valueFmt ? valueFmt(v) : v)} />
        <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} barSize={15} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function Donut({ data, total, totalLabel, money }) {
  if (!data.length) return <p className="dash-empty">No data</p>
  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="none">
            {data.map((s) => (
              <Cell key={s.name} fill={s.fill} />
            ))}
          </Pie>
          <Tooltip contentStyle={tipStyle} formatter={(v) => (money ? fmtMoney(v) : v)} />
        </PieChart>
      </ResponsiveContainer>
      <div className="donut-center">
        <b>{money ? money0(total) : total}</b>
        <span>{totalLabel}</span>
      </div>
      <div className="donut-legend">
        {data.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.fill }} />
            {s.name} · {money ? money0(s.value) : s.value}
          </span>
        ))}
      </div>
    </div>
  )
}

function Funnel({ steps }) {
  const max = steps[0]?.value || 1
  return (
    <div className="funnel">
      {steps.map((s, i) => (
        <div className="funnel-row" key={s.name}>
          <div className="funnel-bar-wrap">
            <div
              className={`funnel-bar f${i}`}
              style={{ width: `${Math.max((s.value / max) * 100, 4)}%` }}
            >
              <span>{s.value}</span>
            </div>
          </div>
          <div className="funnel-meta">
            <b>{s.name}</b>
            <span>{s.pct}%</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Heatmap({ rows, cols, cells, max }) {
  if (!max) return <p className="dash-empty">No appointments in range</p>
  return (
    <div className="heatmap-scroll">
    <div className="heatmap" style={{ gridTemplateColumns: `44px repeat(${cols.length}, 1fr)` }}>
      <span />
      {cols.map((c) => (
        <span key={c} className="hm-col">
          {c.split(' ').map((w) => w[0]).join('')}
        </span>
      ))}
      {rows.map((r, ri) => (
        <FragmentRow key={r} label={r} vals={cells[ri]} max={max} />
      ))}
    </div>
    </div>
  )
}
function FragmentRow({ label, vals, max }) {
  return (
    <>
      <span className="hm-row">{label}</span>
      {vals.map((v, ci) => (
        <span
          key={ci}
          className="hm-cell"
          title={`${v} appointment(s)`}
          style={{ background: v ? `rgba(52,113,184,${0.12 + 0.72 * (v / max)})` : 'var(--surface)' }}
        >
          {v || ''}
        </span>
      ))}
    </>
  )
}

// ── page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { profile, can } = useAuth()
  const showMoney = can('finance', 'view')
  const [rangeKey, setRangeKey] = useState('month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(true)
  const firstName = profile?.full_name?.trim().split(/\s+/)[0]

  const fetchAll = useCallback(async () => {
    const [ord, cus, cli, pay] = await Promise.all([
      supabase.from('orders').select(ORDER_SELECT),
      supabase.from('customers').select('id, created_at'),
      supabase.from('clients').select('id, status'),
      showMoney
        ? supabase.from('payouts').select('party, client_id, agent_id, amount, paid_on')
        : Promise.resolve({ data: [] }),
    ])
    setRaw({
      orders: ord.data ?? [],
      customers: cus.data ?? [],
      clients: cli.data ?? [],
      payouts: pay.data ?? [],
    })
    setLoading(false)
  }, [showMoney])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const win = useMemo(() => rangeWindow(rangeKey, custom), [rangeKey, custom])
  const d = useMemo(
    () => (raw ? buildDashboard({ ...raw, window: win, rangeKey }) : null),
    [raw, win, rangeKey],
  )

  return (
    <div className="page dash">
      <div className="dash-header">
        <h1 className="page-title">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="page-subtitle">
          {d ? `${d.counts.total} order(s) · ${d.counts.pending} awaiting confirmation` : 'Loading your dashboard…'}
        </p>
      </div>

      <DashRange rangeKey={rangeKey} onKey={setRangeKey} custom={custom} onCustom={setCustom} />

      {loading || !d ? (
        <div className="dash-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="panel">
              <div className="dash-skel" />
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* ── KPIs ─────────────────────────────────────────── */}
          <div className="kpi-grid">
            {showMoney ? (
              <>
                <Kpi label="Sales" value={money0(d.money.sales)} delta={d.deltas?.sales} prevLabel={d.prevLabel} spark={d.spark('sales')} sparkColor="#3471b8" icon={TrendingUp} />
                <Kpi label="GraphicSpark net" value={money0(d.money.net)} delta={d.deltas?.net} prevLabel={d.prevLabel} spark={d.spark('net')} sparkColor="#1e874b" icon={Wallet} />
                <Kpi label="GS net (owed by clients)" value={money0(d.money.gsNet)} delta={d.deltas?.gsNet} prevLabel={d.prevLabel} spark={d.spark('sales')} sparkColor="#3471b8" icon={Coins} />
                <Kpi label="Orders" value={d.counts.total} delta={d.deltas?.orders} prevLabel={d.prevLabel} spark={d.spark('ordersCreated')} sparkColor="#7c5cbf" icon={ClipboardList} />
                <Kpi label="Outstanding from clients" value={money0(d.outstanding.fromClients)} icon={Building2} />
                <Kpi label="Owed to agents" value={money0(d.outstanding.toAgents)} icon={HandCoins} />
                <Kpi label="New customers" value={d.newCustomers} delta={d.deltas?.customers} prevLabel={d.prevLabel} icon={UserRound} />
                <Kpi label="Active clients" value={d.activeClients} icon={Building2} />
              </>
            ) : (
              <>
                <Kpi label="Orders" value={d.counts.total} delta={d.deltas?.orders} prevLabel={d.prevLabel} spark={d.spark('ordersCreated')} icon={ClipboardList} />
                <Kpi label="Confirmed" value={d.counts.confirmed} icon={TrendingUp} />
                <Kpi label="Pending" value={d.counts.pending} icon={CalendarClock} />
                <Kpi label="Upcoming appts" value={d.upcoming.length} icon={CalendarClock} />
                <Kpi label="New customers" value={d.newCustomers} delta={d.deltas?.customers} prevLabel={d.prevLabel} icon={UserRound} />
              </>
            )}
          </div>

          {/* ── performance ──────────────────────────────────── */}
          <div className="dash-section-title">Performance</div>
          <div className="dash-row">
            <Panel title={showMoney ? 'Sales & net over time' : 'Orders over time'} sub={d.monthly ? 'monthly' : 'daily'}>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={d.trend} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="gS" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3471b8" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#3471b8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gN" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e874b" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="#1e874b" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={showMoney ? 46 : 30} tickFormatter={showMoney ? kfmt : undefined} />
                  <Tooltip contentStyle={tipStyle} cursor={{ stroke: '#c9ced6' }} formatter={(v, n) => (showMoney && n !== 'Orders' ? fmtMoney(v) : v)} />
                  {showMoney ? (
                    <>
                      <Area type="monotone" dataKey="sales" name="Sales" stroke="#3471b8" strokeWidth={2.2} fill="url(#gS)" activeDot={{ r: 4 }} />
                      <Area type="monotone" dataKey="net" name="Net" stroke="#1e874b" strokeWidth={2.2} fill="url(#gN)" activeDot={{ r: 4 }} />
                    </>
                  ) : (
                    <Area type="monotone" dataKey="ordersCreated" name="Orders" stroke="#3471b8" strokeWidth={2.2} fill="url(#gS)" activeDot={{ r: 4 }} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
              {showMoney && (
                <div className="chart-legend">
                  <span><i style={{ background: '#3471b8' }} />Sales</span>
                  <span><i style={{ background: '#1e874b' }} />Net</span>
                </div>
              )}
            </Panel>

            {showMoney && d.forecast && (
              <Panel title={`${d.forecast.label} forecast`} sub={`${d.forecast.elapsedPct}% elapsed`}>
                <div className="forecast">
                  <ForecastRow which={d.forecast.label} label="Sales" actual={d.forecast.salesActual} projected={d.forecast.salesProjected} pct={d.forecast.elapsedPct} color="#3471b8" />
                  <ForecastRow which={d.forecast.label} label="Net" actual={d.forecast.netActual} projected={d.forecast.netProjected} pct={d.forecast.elapsedPct} color="#1e874b" />
                </div>
              </Panel>
            )}

            <Panel title="Orders by status" sub={`${d.counts.total} in range`}>
              <Donut data={d.statusPie} total={d.counts.total} totalLabel="orders" />
            </Panel>

            {showMoney && d.splitPie.length > 0 && (
              <Panel title="Where the money goes" sub="confirmed">
                <Donut data={d.splitPie} total={d.money.sales} totalLabel="sales" money />
              </Panel>
            )}
          </div>

          {/* ── cash & collections ───────────────────────────── */}
          {showMoney && (
            <>
              <div className="dash-section-title">Cash &amp; collections</div>
              <div className="dash-row">
                <Panel title="Cash flow" sub="in from clients · out to agents">
                  <ResponsiveContainer width="100%" height={240}>
                    <ComposedChart data={d.cashflow} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={GRID} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={20} />
                      <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={46} tickFormatter={kfmt} />
                      <Tooltip contentStyle={tipStyle} formatter={(v) => fmtMoney(v)} />
                      <Bar dataKey="in" name="In" fill="#1e874b" radius={[4, 4, 0, 0]} barSize={14} />
                      <Bar dataKey="out" name="Out" fill="#b7791f" radius={[4, 4, 0, 0]} barSize={14} />
                      <Line type="monotone" dataKey="net" name="Net" stroke="#3471b8" strokeWidth={2} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="chart-legend">
                    <span><i style={{ background: '#1e874b' }} />In</span>
                    <span><i style={{ background: '#b7791f' }} />Out</span>
                    <span><i style={{ background: '#3471b8' }} />Net</span>
                  </div>
                </Panel>

                <Panel title="Receivables aging" sub={money0(d.outstanding.fromClients)}>
                  {d.aging.some((a) => a.value > 0) ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={d.aging} margin={{ top: 8, right: 10, left: -8, bottom: 0 }}>
                        <CartesianGrid stroke={GRID} vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10.5, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
                        <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={46} tickFormatter={kfmt} />
                        <Tooltip contentStyle={tipStyle} formatter={(v) => fmtMoney(v)} />
                        <Bar dataKey="value" name="Outstanding" radius={[5, 5, 0, 0]} barSize={40}>
                          {d.aging.map((a, i) => (
                            <Cell key={a.name} fill={['#1e874b', '#b7791f', '#d98324', '#c0392b'][i]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="dash-empty">Nothing outstanding</p>
                  )}
                </Panel>
              </div>
            </>
          )}

          {/* ── breakdown ────────────────────────────────────── */}
          <div className="dash-section-title">Breakdown</div>
          <div className="dash-row">
            {showMoney && d.topAccounts.length > 0 && (
              <Panel title="Top accounts" sub="by net">
                <MiniBar data={d.topAccounts} color="#1e874b" valueFmt={fmtMoney} />
              </Panel>
            )}
            {showMoney && d.topClients.length > 0 && (
              <Panel title="Top clients" sub="by GS net">
                <MiniBar data={d.topClients} color="#3471b8" valueFmt={fmtMoney} />
              </Panel>
            )}
            {d.topAgents.length > 0 && (
              <Panel title="Top agents" sub="by orders">
                <MiniBar data={d.topAgents} color="#7c5cbf" />
              </Panel>
            )}
            {d.topPackages.length > 0 && (
              <Panel title="Top packages" sub="by orders">
                <MiniBar data={d.topPackages} color="#b7791f" />
              </Panel>
            )}
          </div>

          {/* ── bookings & customers ─────────────────────────── */}
          <div className="dash-section-title">Bookings &amp; customers</div>
          <div className="dash-row">
            <Panel title="Conversion funnel" sub={`${d.funnel[1].pct}% confirm rate`}>
              <Funnel steps={d.funnel} />
            </Panel>

            <Panel title="New vs returning customers" sub="in range">
              <Donut data={d.newVsReturning} total={d.newVsReturning.reduce((a, s) => a + s.value, 0)} totalLabel="customers" />
            </Panel>

            <Panel title="Appointments heatmap" sub="weekday × time">
              <Heatmap {...d.heatmap} />
            </Panel>

            <Panel title="Appointments by weekday" sub="in range">
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={d.weekdayCounts} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={tipStyle} cursor={{ fill: 'rgba(52,113,184,0.06)' }} />
                  <Bar dataKey="value" name="Appointments" fill="#3471b8" radius={[6, 6, 0, 0]} barSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          {/* ── activity ─────────────────────────────────────── */}
          <div className="dash-section-title">Activity</div>
          <div className="dash-row">
            <Panel title="Upcoming appointments" right={<Link to="/orders" className="panel-link">View all <ArrowRight size={11} /></Link>}>
              <List
                rows={d.upcoming}
                empty="No upcoming appointments"
                render={(o) => ({
                  main: o.customer?.full_name ?? '—',
                  sub: `${o.client?.company_name ?? ''} · ${o.package_name || o.service || ''}`,
                  right: `${fmtDate(o.scheduled_date)}${o.scheduled_time ? ` · ${slotLabel(o.scheduled_time)}` : ''}`,
                })}
              />
            </Panel>

            <Panel title="Pending confirmation" sub={d.counts.pending}>
              <List
                rows={d.pendingList}
                empty="Nothing pending"
                render={(o) => ({
                  main: `${o.ref_no} · ${o.customer?.full_name ?? '—'}`,
                  sub: o.client?.company_name ?? '',
                  right: showMoney ? fmtMoney(o.amount) : fmtDate(o.created_at),
                })}
              />
            </Panel>

            <Panel title="Recent confirmed">
              <List
                rows={d.recent}
                empty="No confirmed orders yet"
                render={(o) => ({
                  main: `${o.ref_no} · ${o.customer?.full_name ?? '—'}`,
                  sub: o.client?.company_name ?? '',
                  right: showMoney ? fmtMoney(ledgerAmounts(o).net) : fmtDate(o.confirmed_at),
                })}
              />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

function ForecastRow({ which, label, actual, projected, pct, color }) {
  return (
    <div className="fc-row">
      <div className="fc-head">
        <span>{label}</span>
        <b>{money0(projected)}</b>
      </div>
      <div className="fc-track">
        <div className="fc-fill" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
      </div>
      <div className="fc-sub">
        {money0(actual)} so far · projected {which}-end
      </div>
    </div>
  )
}

function List({ rows, render, empty }) {
  if (!rows.length) return <p className="dash-empty">{empty}</p>
  return (
    <div className="activity-list">
      {rows.map((r) => {
        const c = render(r)
        return (
          <div className="al-row" key={r.id}>
            <span className="al-main">{c.main}</span>
            <span className="al-sub">{c.sub}</span>
            <span className="al-right">{c.right}</span>
          </div>
        )
      })}
    </div>
  )
}
