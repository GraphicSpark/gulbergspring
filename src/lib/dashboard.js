import { ledgerAmounts } from './ledger'
import { TIME_SLOT_GROUPS } from './slots'

// ── date helpers ─────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const DAY = 864e5

function bucketKey(iso, monthly) {
  const d = new Date(iso)
  return monthly
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function bucketLabel(key, monthly) {
  if (monthly) {
    const [y, m] = key.split('-')
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
  }
  const [y, m, d] = key.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
function fillBuckets(startKey, endKey, monthly) {
  const out = []
  if (monthly) {
    const [sy, sm] = startKey.split('-').map(Number)
    const [ey, em] = endKey.split('-').map(Number)
    const cur = new Date(sy, sm - 1, 1)
    const end = new Date(ey, em - 1, 1)
    while (cur <= end) {
      out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`)
      cur.setMonth(cur.getMonth() + 1)
    }
  } else {
    const [sy, sm, sd] = startKey.split('-').map(Number)
    const [ey, em, ed] = endKey.split('-').map(Number)
    const cur = new Date(sy, sm - 1, sd)
    const end = new Date(ey, em - 1, ed)
    while (cur <= end) {
      out.push(isoDay(cur))
      cur.setDate(cur.getDate() + 1)
    }
  }
  return out.slice(-180)
}

const pct = (cur, prev) => {
  if (prev > 0) return ((cur - prev) / prev) * 100
  if (cur > 0) return 100
  return 0
}

const emptyMoney = () => ({ sales: 0, discount: 0, client: 0, gsGross: 0, gsNet: 0, agent: 0, net: 0 })
const addMoney = (a, o) => {
  const x = ledgerAmounts(o)
  return {
    sales: a.sales + x.sales,
    discount: a.discount + x.discount,
    client: a.client + x.client,
    gsGross: a.gsGross + x.gsGross,
    gsNet: a.gsNet + x.gsNet,
    agent: a.agent + x.agent,
    net: a.net + x.net,
  }
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
// which slot-group a "HH:MM[:SS]" belongs to
const SLOT_GROUP_LABELS = TIME_SLOT_GROUPS.map((g) => g.label)
function slotGroupOf(time) {
  const hh = Number(String(time).slice(0, 2))
  for (const g of TIME_SLOT_GROUPS) if (g.options.some((o) => Number(o.value.slice(0, 2)) === hh)) return g.label
  return SLOT_GROUP_LABELS[0]
}

// natural period end for a preset range, else null (no forecast)
function periodEnd(rangeKey) {
  const n = new Date()
  n.setHours(0, 0, 0, 0)
  if (rangeKey === 'month') return isoDay(new Date(n.getFullYear(), n.getMonth() + 1, 0))
  if (rangeKey === 'quarter') return isoDay(new Date(n.getFullYear(), Math.floor(n.getMonth() / 3) * 3 + 3, 0))
  if (rangeKey === 'ytd') return isoDay(new Date(n.getFullYear(), 11, 31))
  return null
}

// ── main aggregate ───────────────────────────────────────────────────────
// window: { from, to } as 'YYYY-MM-DD' ('' from = unbounded); rangeKey drives
// the forecast period + the friendly "vs …" label.
export function buildDashboard({ orders, customers, clients, payouts, window, rangeKey }) {
  const from = window?.from || ''
  const to = window?.to || isoDay(new Date())
  const inWin = (iso) => iso && iso.slice(0, 10) >= (from || '0000') && iso.slice(0, 10) <= to

  const rangedOrders = orders.filter((o) => inWin(o.created_at))
  const confirmedAll = orders.filter((o) => o.status === 'confirmed')
  const confirmed = confirmedAll.filter((o) => inWin(o.confirmed_at))

  const money = confirmed.reduce(addMoney, emptyMoney())
  const counts = {
    total: rangedOrders.length,
    confirmed: rangedOrders.filter((o) => o.status === 'confirmed').length,
    pending: rangedOrders.filter((o) => o.status === 'pending').length,
    cancelled: rangedOrders.filter((o) => o.status === 'cancelled').length,
  }

  // ── previous-period comparison (same-length window right before `from`) ──
  let deltas = null
  let prevLabel = null
  if (from) {
    const fromD = new Date(`${from}T00:00:00`)
    const toD = new Date(`${to}T00:00:00`)
    const spanDays = Math.max(1, Math.round((toD - fromD) / DAY))
    const pFrom = isoDay(new Date(fromD.getTime() - spanDays * DAY))
    const pTo = from
    const inPrev = (iso) => iso && iso.slice(0, 10) >= pFrom && iso.slice(0, 10) < pTo
    const pConf = confirmedAll.filter((o) => inPrev(o.confirmed_at))
    const pMoney = pConf.reduce(addMoney, emptyMoney())
    const pOrders = orders.filter((o) => inPrev(o.created_at)).length
    const pCustomers = customers.filter((c) => inPrev(c.created_at)).length
    deltas = {
      sales: pct(money.sales, pMoney.sales),
      net: pct(money.net, pMoney.net),
      gsNet: pct(money.gsNet, pMoney.gsNet),
      orders: pct(counts.total, pOrders),
      customers: pct(customers.filter((c) => inWin(c.created_at)).length, pCustomers),
    }
    prevLabel =
      rangeKey === 'month' || spanDays >= 28
        ? 'last period'
        : rangeKey === 'today' || spanDays === 1
          ? 'yesterday'
          : spanDays === 7
            ? 'last week'
            : `prev ${spanDays}d`
  }

  // ── running balances + AR aging (all-time, FIFO per client) ──
  const clientPayments = new Map()
  const agentPayments = new Map()
  for (const p of payouts) {
    if (p.party === 'client') clientPayments.set(p.client_id, (clientPayments.get(p.client_id) ?? 0) + Number(p.amount))
    else agentPayments.set(p.agent_id, (agentPayments.get(p.agent_id) ?? 0) + Number(p.amount))
  }

  const ordersByClient = new Map()
  const owedToAgent = new Map()
  for (const o of confirmedAll) {
    const x = ledgerAmounts(o)
    if (o.client?.id) {
      if (!ordersByClient.has(o.client.id)) ordersByClient.set(o.client.id, [])
      ordersByClient.get(o.client.id).push({ at: o.confirmed_at || o.created_at, owed: x.gsNet })
    }
    if (o.agent?.id) owedToAgent.set(o.agent.id, (owedToAgent.get(o.agent.id) ?? 0) + x.agent)
  }

  const agingBuckets = { '0–30 days': 0, '31–60 days': 0, '61–90 days': 0, '90+ days': 0 }
  const now = Date.now()
  let totalReceivable = 0
  for (const [cid, list] of ordersByClient) {
    list.sort((a, b) => (a.at || '').localeCompare(b.at || ''))
    let received = clientPayments.get(cid) ?? 0
    for (const it of list) {
      const applied = Math.min(received, it.owed)
      received -= applied
      const remaining = it.owed - applied
      if (remaining <= 0.5) continue
      totalReceivable += remaining
      const ageDays = it.at ? (now - new Date(it.at).getTime()) / DAY : 0
      const b = ageDays <= 30 ? '0–30 days' : ageDays <= 60 ? '31–60 days' : ageDays <= 90 ? '61–90 days' : '90+ days'
      agingBuckets[b] += remaining
    }
  }
  const aging = Object.entries(agingBuckets).map(([name, value]) => ({ name, value }))

  const sumMap = (m) => [...m.values()].reduce((a, b) => a + b, 0)
  const outstanding = {
    fromClients: totalReceivable,
    toAgents: sumMap(owedToAgent) - sumMap(agentPayments),
  }

  // ── time series ──
  const spanDaysWin = from ? Math.max(1, Math.round((new Date(to) - new Date(from)) / DAY)) : 999
  const monthly = spanDaysWin > 120
  const startKey = bucketKey(`${from || confirmed.reduce((m, o) => (!m || (o.confirmed_at || o.created_at) < m ? o.confirmed_at || o.created_at : m), '')?.slice(0, 10) || to}T00:00:00`, monthly)
  const keys = fillBuckets(startKey, bucketKey(`${to}T00:00:00`, monthly), monthly)
  const byBucket = new Map(
    keys.map((k) => [k, { key: k, label: bucketLabel(k, monthly), sales: 0, net: 0, orders: 0, ordersCreated: 0, in: 0, out: 0 }]),
  )
  for (const o of confirmed) {
    const b = byBucket.get(bucketKey(o.confirmed_at || o.created_at, monthly))
    if (!b) continue
    const x = ledgerAmounts(o)
    b.sales += x.sales
    b.net += x.net
    b.orders += 1
  }
  for (const o of rangedOrders) {
    const b = byBucket.get(bucketKey(o.created_at, monthly))
    if (b) b.ordersCreated += 1
  }
  for (const p of payouts) {
    if (!inWin(p.paid_on)) continue
    const b = byBucket.get(bucketKey(`${p.paid_on}T00:00:00`, monthly))
    if (!b) continue
    if (p.party === 'client') b.in += Number(p.amount)
    else b.out += Number(p.amount)
  }
  const trend = [...byBucket.values()]
  const cashflow = trend.map((b) => ({ label: b.label, in: b.in, out: b.out, net: b.in - b.out }))
  const spark = (field) => trend.map((b) => ({ v: b[field] ?? 0 }))

  // ── forecast: project the run-rate to the natural period end ──
  let forecast = null
  const pEnd = periodEnd(rangeKey)
  if (from && pEnd) {
    const startD = new Date(`${from}T00:00:00`)
    const endD = new Date(`${pEnd}T00:00:00`)
    const totalDays = Math.max(1, Math.round((endD - startD) / DAY) + 1)
    const elapsed = Math.max(1, Math.min(totalDays, Math.round((Date.now() - startD.getTime()) / DAY) + 1))
    if (elapsed < totalDays) {
      const factor = totalDays / elapsed
      forecast = {
        label: rangeKey === 'month' ? 'month' : rangeKey === 'quarter' ? 'quarter' : 'year',
        elapsedPct: Math.round((elapsed / totalDays) * 100),
        salesActual: money.sales,
        salesProjected: money.sales * factor,
        netActual: money.net,
        netProjected: money.net * factor,
      }
    }
  }

  // ── breakdowns ──
  const topBy = (keyFn, valFn, limit = 6) => {
    const m = new Map()
    for (const o of confirmed) {
      const k = keyFn(o)
      if (!k) continue
      const cur = m.get(k.id) ?? { id: k.id, name: k.name, value: 0, orders: 0 }
      cur.value += valFn(o)
      cur.orders += 1
      m.set(k.id, cur)
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, limit)
  }
  const topAccounts = topBy((o) => (o.account ? { id: o.account.id, name: o.account.name } : null), (o) => ledgerAmounts(o).net)
  const topClients = topBy((o) => (o.client ? { id: o.client.id, name: o.client.company_name } : null), (o) => ledgerAmounts(o).gsNet)
  const topAgents = topBy((o) => (o.agent ? { id: o.agent.id, name: o.agent.full_name } : null), () => 1)
  const topPackages = topBy(
    (o) => {
      const n = o.package_name || o.service
      return n ? { id: n, name: n } : null
    },
    () => 1,
  )

  const statusPie = [
    { name: 'Confirmed', value: counts.confirmed, fill: '#1e874b' },
    { name: 'Pending', value: counts.pending, fill: '#b7791f' },
    { name: 'Cancelled', value: counts.cancelled, fill: '#c0392b' },
  ].filter((s) => s.value > 0)

  const splitPie = [
    { name: 'Client cut', value: Math.max(money.client, 0), fill: '#b7791f' },
    { name: 'Agent cut', value: Math.max(money.agent, 0), fill: '#7c5cbf' },
    { name: 'GraphicSpark net', value: Math.max(money.net, 0), fill: '#1e874b' },
  ].filter((s) => s.value > 0)

  // ── conversion funnel ──
  const funnel = [
    { name: 'Created', value: counts.total, pct: 100 },
    { name: 'Confirmed', value: counts.confirmed, pct: counts.total ? Math.round((counts.confirmed / counts.total) * 100) : 0 },
    { name: 'Cancelled', value: counts.cancelled, pct: counts.total ? Math.round((counts.cancelled / counts.total) * 100) : 0 },
  ]

  // ── new vs returning customers (in window) ──
  const firstOrderAt = new Map()
  for (const o of orders) {
    if (!o.customer_id || !o.created_at) continue
    const cur = firstOrderAt.get(o.customer_id)
    if (!cur || o.created_at < cur) firstOrderAt.set(o.customer_id, o.created_at)
  }
  const seenInWin = new Set(rangedOrders.map((o) => o.customer_id).filter(Boolean))
  let nNew = 0
  let nReturning = 0
  for (const cid of seenInWin) {
    const first = firstOrderAt.get(cid)
    if (first && from && first.slice(0, 10) < from) nReturning += 1
    else nNew += 1
  }
  const newVsReturning = [
    { name: 'New', value: nNew, fill: '#3471b8' },
    { name: 'Returning', value: nReturning, fill: '#1e874b' },
  ].filter((s) => s.value > 0)

  // ── appointment heatmap: weekday × slot-group ──
  const cells = WEEKDAYS.map(() => SLOT_GROUP_LABELS.map(() => 0))
  let heatMax = 0
  for (const o of rangedOrders) {
    if (!o.scheduled_date) continue
    const wd = (new Date(`${o.scheduled_date}T00:00:00`).getDay() + 6) % 7 // Mon=0
    const col = o.scheduled_time ? SLOT_GROUP_LABELS.indexOf(slotGroupOf(o.scheduled_time)) : 0
    if (col < 0) continue
    cells[wd][col] += 1
    if (cells[wd][col] > heatMax) heatMax = cells[wd][col]
  }
  const heatmap = { rows: WEEKDAYS, cols: SLOT_GROUP_LABELS, cells, max: heatMax }

  const weekdayCounts = WEEKDAYS.map((day, i) => ({ name: day, value: cells[i].reduce((a, b) => a + b, 0) }))

  // ── lists ──
  const recent = [...confirmed].sort((a, b) => (b.confirmed_at || '').localeCompare(a.confirmed_at || '')).slice(0, 6)
  const todayStr = isoDay(new Date())
  const upcoming = orders
    .filter((o) => o.status !== 'cancelled' && o.scheduled_date && o.scheduled_date >= todayStr)
    .sort((a, b) => `${a.scheduled_date}${a.scheduled_time ?? ''}`.localeCompare(`${b.scheduled_date}${b.scheduled_time ?? ''}`))
    .slice(0, 6)
  const pendingList = orders
    .filter((o) => o.status === 'pending')
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 6)

  return {
    money,
    counts,
    deltas,
    prevLabel,
    outstanding,
    aging,
    forecast,
    trend,
    cashflow,
    spark,
    monthly,
    topAccounts,
    topClients,
    topAgents,
    topPackages,
    statusPie,
    splitPie,
    funnel,
    newVsReturning,
    heatmap,
    weekdayCounts,
    recent,
    upcoming,
    pendingList,
    newCustomers: customers.filter((c) => inWin(c.created_at)).length,
    activeClients: clients.filter((c) => c.status === 'active').length,
    totalCustomers: customers.length,
  }
}
