// The Reports catalogue. Each report's `build({orders, payouts, customers,
// clients, from, to})` returns { kpis, columns, rows, filename, chart? } - pure
// data, no JSX. `ReportView.jsx` renders the shell + `chart` ({type, data}).
//
// Reuses src/lib/ledger.js (ledgerAmounts / lineClientCut / packageSummary).

import { ledgerAmounts, lineClientCut, packageSummary } from './ledger'
import { fmtDate, fmtMoney } from './format'

const M = (v) => fmtMoney(v)
const pctOf = (n, d) => (d > 0 ? Math.round((n / d) * 100) : 0)
const isoMonth = (iso) => String(iso).slice(0, 7)
const monthLabel = (key) => {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}
const within = (iso, from, to) => {
  if (!iso) return false
  const d = iso.slice(0, 10)
  return (!from || d >= from) && (!to || d <= to)
}
// ordered list of month keys spanning the data (so empty months still show)
const monthSpan = (keys) => {
  if (keys.length === 0) return []
  const sorted = [...keys].sort()
  const [sy, sm] = sorted[0].split('-').map(Number)
  const [ey, em] = sorted[sorted.length - 1].split('-').map(Number)
  const out = []
  const cur = new Date(sy, sm - 1, 1)
  const end = new Date(ey, em - 1, 1)
  while (cur <= end) {
    out.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`)
    cur.setMonth(cur.getMonth() + 1)
  }
  return out.slice(-36)
}

const confirmedIn = (orders, from, to) =>
  orders.filter((o) => o.status === 'confirmed' && within(o.confirmed_at || o.created_at, from, to))

// ── P&L summary ────────────────────────────────────────────────────────────
function buildPnl({ orders, from, to }) {
  const rows = confirmedIn(orders, from, to)
  const byMonth = new Map()
  const zero = () => ({ orders: 0, sales: 0, client: 0, gsGross: 0, discount: 0, gsNet: 0, agent: 0, net: 0 })
  for (const o of rows) {
    const k = isoMonth(o.confirmed_at || o.created_at)
    const a = ledgerAmounts(o)
    const cur = byMonth.get(k) ?? zero()
    cur.orders += 1
    cur.sales += a.sales
    cur.client += a.client
    cur.gsGross += a.gsGross
    cur.discount += a.discount
    cur.gsNet += a.gsNet
    cur.agent += a.agent
    cur.net += a.net
    byMonth.set(k, cur)
  }
  const total = zero()
  for (const v of byMonth.values()) for (const f of Object.keys(total)) total[f] += v[f]

  const months = monthSpan([...byMonth.keys()])
  const dataRows = months.map((k) => {
    const v = byMonth.get(k) ?? zero()
    return {
      month: monthLabel(k),
      orders: v.orders,
      sales: M(v.sales),
      client: M(v.client),
      gsGross: M(v.gsGross),
      discount: M(v.discount),
      gsNet: M(v.gsNet),
      agent: M(v.agent),
      net: M(v.net),
      _net: v.net,
    }
  })
  dataRows.push({
    month: 'TOTAL',
    orders: total.orders,
    sales: M(total.sales),
    client: M(total.client),
    gsGross: M(total.gsGross),
    discount: M(total.discount),
    gsNet: M(total.gsNet),
    agent: M(total.agent),
    net: M(total.net),
    _total: true,
  })

  return {
    kpis: [
      { key: 's', label: 'Sales', value: M(total.sales) },
      { key: 'gg', label: 'GS gross', value: M(total.gsGross) },
      { key: 'd', label: 'Discount', value: M(total.discount) },
      { key: 'gn', label: 'GS net (owed by clients)', value: M(total.gsNet) },
      { key: 'a', label: 'Agent payable', value: M(total.agent) },
      { key: 'n', label: 'Net', value: M(total.net) },
    ],
    columns: [
      { key: 'month', header: 'Month' },
      { key: 'orders', header: 'Orders', align: 'right' },
      { key: 'sales', header: 'Sales', align: 'right' },
      { key: 'client', header: 'Client cut', align: 'right' },
      { key: 'gsGross', header: 'GS gross', align: 'right' },
      { key: 'discount', header: 'Discount', align: 'right' },
      { key: 'gsNet', header: 'GS net', align: 'right' },
      { key: 'agent', header: 'Agent cut', align: 'right' },
      { key: 'net', header: 'Net', align: 'right' },
    ],
    rows: dataRows,
    filename: 'pnl_summary',
    chart: {
      type: 'moneyTrend',
      data: months.map((k) => {
        const v = byMonth.get(k) ?? zero()
        return { label: monthLabel(k).replace(' ', "'"), Sales: Math.round(v.sales), Net: Math.round(v.net) }
      }),
    },
  }
}

// ── Sales trend ────────────────────────────────────────────────────────────
function buildSalesTrend({ orders, from, to }) {
  const rows = confirmedIn(orders, from, to)
  const byMonth = new Map()
  for (const o of rows) {
    const k = isoMonth(o.confirmed_at || o.created_at)
    const a = ledgerAmounts(o)
    const cur = byMonth.get(k) ?? { orders: 0, sales: 0, net: 0 }
    cur.orders += 1
    cur.sales += a.sales
    cur.net += a.net
    byMonth.set(k, cur)
  }
  const months = monthSpan([...byMonth.keys()])
  const t = { orders: 0, sales: 0, net: 0 }
  for (const v of byMonth.values()) { t.orders += v.orders; t.sales += v.sales; t.net += v.net }
  const dataRows = months.map((k) => {
    const v = byMonth.get(k) ?? { orders: 0, sales: 0, net: 0 }
    return { month: monthLabel(k), orders: v.orders, sales: M(v.sales), net: M(v.net), aov: M(v.orders ? v.sales / v.orders : 0) }
  })
  return {
    kpis: [
      { key: 'o', label: 'Confirmed orders', value: t.orders },
      { key: 's', label: 'Sales', value: M(t.sales) },
      { key: 'n', label: 'Net', value: M(t.net) },
      { key: 'a', label: 'Avg order value', value: M(t.orders ? t.sales / t.orders : 0) },
    ],
    columns: [
      { key: 'month', header: 'Month' },
      { key: 'orders', header: 'Orders', align: 'right' },
      { key: 'sales', header: 'Sales', align: 'right' },
      { key: 'net', header: 'Net', align: 'right' },
      { key: 'aov', header: 'Avg order', align: 'right' },
    ],
    rows: dataRows,
    filename: 'sales_trend',
    chart: {
      type: 'salesOrders',
      data: months.map((k) => {
        const v = byMonth.get(k) ?? { orders: 0, sales: 0 }
        return { label: monthLabel(k).replace(' ', "'"), Sales: Math.round(v.sales), Orders: v.orders }
      }),
    },
  }
}

// ── Discounts given ────────────────────────────────────────────────────────
function buildDiscounts({ orders, from, to }) {
  const rows = confirmedIn(orders, from, to).filter((o) => {
    const a = ledgerAmounts(o)
    return a.discount > 0.5
  })
  let totalDisc = 0
  let totalSales = 0
  const data = rows
    .map((o) => {
      const a = ledgerAmounts(o)
      totalDisc += a.discount
      totalSales += a.sales
      return {
        id: o.id,
        date: fmtDate(o.confirmed_at || o.created_at),
        customer: o.customer?.full_name ?? '—',
        packages: packageSummary(o),
        sales: M(a.sales),
        discount: M(a.discount),
        pct: `${a.sales ? Math.round((a.discount / a.sales) * 100) : 0}%`,
        agent: o.agent?.full_name ?? '—',
        _disc: a.discount,
      }
    })
    .sort((x, y) => y._disc - x._disc)
  return {
    kpis: [
      { key: 'n', label: 'Orders discounted', value: rows.length },
      { key: 't', label: 'Total discount', value: M(totalDisc) },
      { key: 'p', label: 'Avg discount %', value: `${totalSales ? Math.round((totalDisc / totalSales) * 100) : 0}%` },
      { key: 'm', label: 'Margin absorbed', value: M(totalDisc) },
    ],
    columns: [
      { key: 'date', header: 'Date' },
      { key: 'customer', header: 'Customer' },
      { key: 'packages', header: 'Packages' },
      { key: 'sales', header: 'Sales', align: 'right' },
      { key: 'discount', header: 'Discount', align: 'right' },
      { key: 'pct', header: '%', align: 'right' },
      { key: 'agent', header: 'Agent' },
    ],
    rows: data,
    filename: 'discounts',
  }
}

// ── Order status ──────────────────────────────────────────────────────────
function buildOrderStatus({ orders, from, to }) {
  const rows = orders.filter((o) => within(o.created_at, from, to))
  const byMonth = new Map()
  for (const o of rows) {
    const k = isoMonth(o.created_at)
    const cur = byMonth.get(k) ?? { created: 0, confirmed: 0, pending: 0, cancelled: 0 }
    cur.created += 1
    if (o.status === 'confirmed') cur.confirmed += 1
    else if (o.status === 'pending') cur.pending += 1
    else if (o.status === 'cancelled') cur.cancelled += 1
    byMonth.set(k, cur)
  }
  const months = monthSpan([...byMonth.keys()])
  const t = { created: 0, confirmed: 0, pending: 0, cancelled: 0 }
  for (const v of byMonth.values()) for (const f of Object.keys(t)) t[f] += v[f]
  const dataRows = months.map((k) => {
    const v = byMonth.get(k) ?? { created: 0, confirmed: 0, pending: 0, cancelled: 0 }
    return {
      month: monthLabel(k),
      created: v.created,
      confirmed: v.confirmed,
      pending: v.pending,
      cancelled: v.cancelled,
      conversion: `${pctOf(v.confirmed, v.confirmed + v.cancelled)}%`,
    }
  })
  return {
    kpis: [
      { key: 'c', label: 'Created', value: t.created },
      { key: 'cf', label: 'Confirmed', value: t.confirmed },
      { key: 'pd', label: 'Pending', value: t.pending },
      { key: 'cx', label: 'Cancelled', value: t.cancelled },
      { key: 'cv', label: 'Conversion', value: `${pctOf(t.confirmed, t.confirmed + t.cancelled)}%` },
    ],
    columns: [
      { key: 'month', header: 'Month' },
      { key: 'created', header: 'Created', align: 'right' },
      { key: 'confirmed', header: 'Confirmed', align: 'right' },
      { key: 'pending', header: 'Pending', align: 'right' },
      { key: 'cancelled', header: 'Cancelled', align: 'right' },
      { key: 'conversion', header: 'Conversion', align: 'right' },
    ],
    rows: dataRows,
    filename: 'order_status',
    chart: {
      type: 'statusBars',
      data: months.map((k) => {
        const v = byMonth.get(k) ?? { confirmed: 0, pending: 0, cancelled: 0 }
        return { label: monthLabel(k).replace(' ', "'"), Confirmed: v.confirmed, Pending: v.pending, Cancelled: v.cancelled }
      }),
    },
  }
}

// ── Client report ─────────────────────────────────────────────────────────
function buildClientReport({ orders, payouts, clients, from, to }) {
  const statusOf = new Map((clients ?? []).map((c) => [c.id, c.status]))
  const g = new Map()
  for (const o of confirmedIn(orders, from, to)) {
    if (!o.client?.id) continue
    const a = ledgerAmounts(o)
    const cur = g.get(o.client.id) ?? { id: o.client.id, name: o.client.company_name, orders: 0, sales: 0, receivable: 0, received: 0, last: '' }
    cur.orders += 1
    cur.sales += a.sales
    cur.receivable += a.gsNet
    const d = o.confirmed_at || o.created_at
    if (d > cur.last) cur.last = d
    g.set(o.client.id, cur)
  }
  for (const p of payouts ?? []) {
    if (p.party !== 'client' || !within(p.paid_on, from, to)) continue
    const cur = g.get(p.client_id)
    if (cur) cur.received += Number(p.amount)
  }
  const t = { orders: 0, sales: 0, receivable: 0, received: 0 }
  const data = [...g.values()]
    .map((c) => {
      t.orders += c.orders; t.sales += c.sales; t.receivable += c.receivable; t.received += c.received
      return {
        id: c.id,
        client: c.name,
        status: c.status ?? statusOf.get(c.id) ?? '—',
        orders: c.orders,
        sales: M(c.sales),
        receivable: M(c.receivable),
        received: M(c.received),
        balance: M(c.receivable - c.received),
        last: c.last ? fmtDate(c.last) : '—',
        _bal: c.receivable - c.received,
      }
    })
    .sort((x, y) => y._bal - x._bal)
  return {
    kpis: [
      { key: 'c', label: 'Clients', value: data.length },
      { key: 'o', label: 'Orders', value: t.orders },
      { key: 's', label: 'Sales', value: M(t.sales) },
      { key: 'r', label: 'Receivable (GS net)', value: M(t.receivable) },
      { key: 'rc', label: 'Received', value: M(t.received) },
      { key: 'b', label: 'Outstanding', value: M(t.receivable - t.received) },
    ],
    columns: [
      { key: 'client', header: 'Client' },
      { key: 'status', header: 'Status' },
      { key: 'orders', header: 'Orders', align: 'right' },
      { key: 'sales', header: 'Sales', align: 'right' },
      { key: 'receivable', header: 'Receivable', align: 'right' },
      { key: 'received', header: 'Received', align: 'right' },
      { key: 'balance', header: 'Outstanding', align: 'right' },
      { key: 'last', header: 'Last order' },
    ],
    rows: data,
    filename: 'client_report',
  }
}

// ── Account report ────────────────────────────────────────────────────────
function buildAccountReport({ orders, accounts, from, to }) {
  const zero = () => ({ orders: 0, sales: 0, client: 0, gsGross: 0, discount: 0, gsNet: 0, agent: 0, net: 0 })
  const g = new Map()
  // seed every account so idle ones still show
  for (const a of accounts ?? []) {
    g.set(a.id, { id: a.id, name: a.name, manager: a.manager?.full_name ?? '—', location: a.location ?? '—', ...zero() })
  }
  for (const o of confirmedIn(orders, from, to)) {
    const id = o.account?.id
    if (!id) continue
    const cur =
      g.get(id) ??
      { id, name: o.account.name, manager: o.account.manager?.full_name ?? '—', location: '—', ...zero() }
    const a = ledgerAmounts(o)
    cur.orders += 1
    cur.sales += a.sales
    cur.client += a.client
    cur.gsGross += a.gsGross
    cur.discount += a.discount
    cur.gsNet += a.gsNet
    cur.agent += a.agent
    cur.net += a.net
    g.set(id, cur)
  }
  const t = zero()
  const data = [...g.values()]
    .map((a) => {
      for (const f of Object.keys(t)) t[f] += a[f]
      return {
        id: a.id,
        account: a.name,
        manager: a.manager,
        location: a.location,
        orders: a.orders,
        sales: M(a.sales),
        client: M(a.client),
        gsGross: M(a.gsGross),
        discount: M(a.discount),
        gsNet: M(a.gsNet),
        agent: M(a.agent),
        net: M(a.net),
        _net: a.net,
      }
    })
    .sort((x, y) => y._net - x._net)
  return {
    kpis: [
      { key: 'a', label: 'Accounts', value: data.length },
      { key: 'ac', label: 'With orders', value: data.filter((r) => r.orders > 0).length },
      { key: 'o', label: 'Orders', value: t.orders },
      { key: 's', label: 'Sales', value: M(t.sales) },
      { key: 'gn', label: 'GS net', value: M(t.gsNet) },
      { key: 'n', label: 'Net', value: M(t.net) },
    ],
    columns: [
      { key: 'account', header: 'Account' },
      { key: 'manager', header: 'Manager' },
      { key: 'location', header: 'Location' },
      { key: 'orders', header: 'Orders', align: 'right' },
      { key: 'sales', header: 'Sales', align: 'right' },
      { key: 'client', header: 'Client cut', align: 'right' },
      { key: 'gsGross', header: 'GS gross', align: 'right' },
      { key: 'discount', header: 'Discount', align: 'right' },
      { key: 'gsNet', header: 'GS net', align: 'right' },
      { key: 'agent', header: 'Agent cut', align: 'right' },
      { key: 'net', header: 'Net', align: 'right' },
    ],
    rows: data,
    filename: 'account_report',
  }
}

// ── Agent report ──────────────────────────────────────────────────────────
function buildAgentReport({ orders, payouts, from, to }) {
  const g = new Map()
  for (const o of orders) {
    if (!o.agent?.id) continue
    const created = within(o.created_at, from, to)
    const conf = o.status === 'confirmed' && within(o.confirmed_at || o.created_at, from, to)
    if (!created && !conf) continue
    const cur =
      g.get(o.agent.id) ?? { id: o.agent.id, name: o.agent.full_name, orders: 0, confirmed: 0, cancelled: 0, commission: 0, paid: 0, net: 0 }
    if (created) {
      cur.orders += 1
      if (o.status === 'cancelled') cur.cancelled += 1
    }
    if (conf) {
      const a = ledgerAmounts(o)
      cur.confirmed += 1
      cur.commission += a.agent
      cur.net += a.net
    }
    g.set(o.agent.id, cur)
  }
  for (const p of payouts ?? []) {
    if (p.party !== 'agent' || !within(p.paid_on, from, to)) continue
    const cur = g.get(p.agent_id)
    if (cur) cur.paid += Number(p.amount)
  }
  const t = { orders: 0, confirmed: 0, cancelled: 0, commission: 0, paid: 0, net: 0 }
  const data = [...g.values()]
    .map((a) => {
      for (const f of Object.keys(t)) t[f] += a[f]
      return {
        id: a.id,
        agent: a.name,
        orders: a.orders,
        confirmed: a.confirmed,
        conversion: `${pctOf(a.confirmed, a.confirmed + a.cancelled)}%`,
        commission: M(a.commission),
        paid: M(a.paid),
        balance: M(a.commission - a.paid),
        net: M(a.net),
        _net: a.net,
      }
    })
    .sort((x, y) => y._net - x._net)
  return {
    kpis: [
      { key: 'ag', label: 'Agents', value: data.length },
      { key: 'o', label: 'Orders', value: t.orders },
      { key: 'cf', label: 'Confirmed', value: t.confirmed },
      { key: 'cv', label: 'Conversion', value: `${pctOf(t.confirmed, t.confirmed + t.cancelled)}%` },
      { key: 'com', label: 'Commission', value: M(t.commission) },
      { key: 'pd', label: 'Paid', value: M(t.paid) },
      { key: 'n', label: 'Company net', value: M(t.net) },
    ],
    columns: [
      { key: 'agent', header: 'Agent' },
      { key: 'orders', header: 'Orders', align: 'right' },
      { key: 'confirmed', header: 'Confirmed', align: 'right' },
      { key: 'conversion', header: 'Conv.', align: 'right' },
      { key: 'commission', header: 'Commission', align: 'right' },
      { key: 'paid', header: 'Paid', align: 'right' },
      { key: 'balance', header: 'Outstanding', align: 'right' },
      { key: 'net', header: 'Company net', align: 'right' },
    ],
    rows: data,
    filename: 'agent_report',
  }
}

// ── Package sales ─────────────────────────────────────────────────────────
function buildPackageSales({ orders, from, to }) {
  const g = new Map()
  for (const o of confirmedIn(orders, from, to)) {
    const items = o.order_items?.length
      ? o.order_items
      : [{ package_name: o.package_name || o.service || '—', line_total: o.list_amount ?? o.amount, client_kind: o.client_kind, client_value: o.client_value, qty: 1 }]
    for (const it of items) {
      const name = it.package_name || '—'
      const cur = g.get(name) ?? { name, qty: 0, orders: new Set(), sales: 0, client: 0 }
      cur.qty += Number(it.qty) || 1
      cur.orders.add(o.id)
      cur.sales += Number(it.line_total) || 0
      cur.client += lineClientCut(it)
      g.set(name, cur)
    }
  }
  const t = { qty: 0, orders: 0, sales: 0, client: 0, gsGross: 0 }
  const data = [...g.values()]
    .map((p) => {
      const gsGross = p.sales - p.client
      t.qty += p.qty; t.orders += p.orders.size; t.sales += p.sales; t.client += p.client; t.gsGross += gsGross
      return {
        id: p.name,
        package: p.name,
        qty: p.qty,
        orders: p.orders.size,
        sales: M(p.sales),
        client: M(p.client),
        gsGross: M(gsGross),
        _sales: p.sales,
      }
    })
    .sort((x, y) => y._sales - x._sales)
  return {
    kpis: [
      { key: 'p', label: 'Packages', value: data.length },
      { key: 'q', label: 'Qty sold', value: t.qty },
      { key: 's', label: 'Sales', value: M(t.sales) },
      { key: 'c', label: 'Client cut', value: M(t.client) },
      { key: 'gg', label: 'GS gross', value: M(t.gsGross) },
    ],
    columns: [
      { key: 'package', header: 'Package' },
      { key: 'qty', header: 'Qty', align: 'right' },
      { key: 'orders', header: 'Orders', align: 'right' },
      { key: 'sales', header: 'Sales', align: 'right' },
      { key: 'client', header: 'Client cut', align: 'right' },
      { key: 'gsGross', header: 'GS gross', align: 'right' },
    ],
    rows: data,
    filename: 'package_sales',
  }
}

// ── Top customers ─────────────────────────────────────────────────────────
function buildTopCustomers({ orders, customers, from, to }) {
  const info = new Map((customers ?? []).map((c) => [c.id, c]))
  const g = new Map()
  for (const o of orders) {
    if (!o.customer_id || !within(o.created_at, from, to)) continue
    const cur = g.get(o.customer_id) ?? { id: o.customer_id, visits: 0, paid: 0, last: '' }
    cur.visits += 1
    if (o.status === 'confirmed') cur.paid += Number(o.amount) || 0
    if (o.created_at > cur.last) cur.last = o.created_at
    g.set(o.customer_id, cur)
  }
  let totalPaid = 0
  const data = [...g.values()]
    .map((c) => {
      const ci = info.get(c.id)
      totalPaid += c.paid
      return {
        id: c.id,
        customer: ci?.full_name ?? '—',
        phone: ci?.phone ?? '',
        source: ci?.source ?? '—',
        visits: c.visits,
        paid: M(c.paid),
        last: c.last ? fmtDate(c.last) : '—',
        _paid: c.paid,
      }
    })
    .sort((x, y) => y._paid - x._paid || y.visits - x.visits)
  const repeat = data.filter((c) => c.visits > 1).length
  return {
    kpis: [
      { key: 'c', label: 'Customers', value: data.length },
      { key: 'r', label: 'Repeat (2+ visits)', value: repeat },
      { key: 'rr', label: 'Repeat rate', value: `${pctOf(repeat, data.length)}%` },
      { key: 'p', label: 'Total collected', value: M(totalPaid) },
    ],
    columns: [
      { key: 'customer', header: 'Customer' },
      { key: 'phone', header: 'Phone' },
      { key: 'source', header: 'Source' },
      { key: 'visits', header: 'Visits', align: 'right' },
      { key: 'paid', header: 'Total paid', align: 'right' },
      { key: 'last', header: 'Last visit' },
    ],
    rows: data,
    filename: 'top_customers',
  }
}

// ── Cash flow ─────────────────────────────────────────────────────────────
function buildCashFlow({ payouts, from, to }) {
  const rows = (payouts ?? []).filter((p) => within(p.paid_on, from, to))
  const byMonth = new Map()
  for (const p of rows) {
    const k = isoMonth(p.paid_on)
    const cur = byMonth.get(k) ?? { in: 0, out: 0 }
    if (p.party === 'client') cur.in += Number(p.amount)
    else cur.out += Number(p.amount)
    byMonth.set(k, cur)
  }
  const months = monthSpan([...byMonth.keys()])
  let running = 0
  let tin = 0
  let tout = 0
  const dataRows = months.map((k) => {
    const v = byMonth.get(k) ?? { in: 0, out: 0 }
    running += v.in - v.out
    tin += v.in
    tout += v.out
    return { month: monthLabel(k), inn: M(v.in), out: M(v.out), net: M(v.in - v.out), balance: M(running) }
  })
  return {
    kpis: [
      { key: 'i', label: 'Money in (clients)', value: M(tin) },
      { key: 'o', label: 'Money out (agents)', value: M(tout) },
      { key: 'n', label: 'Net cash flow', value: M(tin - tout) },
    ],
    columns: [
      { key: 'month', header: 'Month' },
      { key: 'inn', header: 'In', align: 'right' },
      { key: 'out', header: 'Out', align: 'right' },
      { key: 'net', header: 'Net', align: 'right' },
      { key: 'balance', header: 'Running balance', align: 'right' },
    ],
    rows: dataRows,
    filename: 'cash_flow',
    chart: {
      type: 'cashflow',
      data: (() => {
        let r = 0
        return months.map((k) => {
          const v = byMonth.get(k) ?? { in: 0, out: 0 }
          r += v.in - v.out
          return { label: monthLabel(k).replace(' ', "'"), In: Math.round(v.in), Out: Math.round(v.out), Balance: Math.round(r) }
        })
      })(),
    },
  }
}

// ── Settlements ──────────────────────────────────────────────────────────
function buildSettlements({ payouts, from, to }) {
  const rows = (payouts ?? [])
    .filter((p) => within(p.paid_on, from, to))
    .sort((a, b) => (b.paid_on || '').localeCompare(a.paid_on || ''))
  let tin = 0
  let tout = 0
  const data = rows.map((p) => {
    if (p.party === 'client') tin += Number(p.amount)
    else tout += Number(p.amount)
    return {
      id: p.id,
      date: fmtDate(p.paid_on),
      party: p.party === 'client' ? 'Client (in)' : 'Agent (out)',
      who: p.party === 'client' ? (p.client?.company_name ?? '—') : (p.agent?.full_name ?? '—'),
      amount: `${p.party === 'client' ? '+' : '−'} ${M(p.amount)}`,
      method: p.method || '—',
      note: p.note || '',
    }
  })
  return {
    kpis: [
      { key: 'n', label: 'Settlements', value: rows.length },
      { key: 'i', label: 'Received from clients', value: M(tin) },
      { key: 'o', label: 'Paid to agents', value: M(tout) },
      { key: 'net', label: 'Net', value: M(tin - tout) },
    ],
    columns: [
      { key: 'date', header: 'Date' },
      { key: 'party', header: 'Type' },
      { key: 'who', header: 'Party' },
      { key: 'amount', header: 'Amount', align: 'right' },
      { key: 'method', header: 'Method' },
      { key: 'note', header: 'Note' },
    ],
    rows: data,
    filename: 'settlements',
  }
}

export const REPORTS = [
  { key: 'pnl', label: 'P&L summary', group: 'Sales & revenue', subtitle: 'Month-by-month profit & loss on confirmed orders', build: buildPnl },
  { key: 'sales-trend', label: 'Sales trend', group: 'Sales & revenue', subtitle: 'Confirmed sales, net and order volume over time', build: buildSalesTrend },
  { key: 'discounts', label: 'Discounts given', group: 'Sales & revenue', subtitle: 'Every confirmed order that carried a discount', build: buildDiscounts },
  { key: 'order-status', label: 'Order status', group: 'Sales & revenue', subtitle: 'Created vs confirmed / pending / cancelled + conversion', build: buildOrderStatus },
  { key: 'client-report', label: 'Client report', group: 'Parties', subtitle: 'Per client: sales, receivable (GS net), received, outstanding', build: buildClientReport },
  { key: 'agent-report', label: 'Agent report', group: 'Parties', subtitle: 'Per agent: orders, conversion, commission, outstanding, net', build: buildAgentReport },
  { key: 'account-report', label: 'Account report', group: 'Parties', subtitle: 'Per account: manager, orders and the full P&L chain', build: buildAccountReport },
  { key: 'package-sales', label: 'Package sales', group: 'Catalog', subtitle: 'Per package (line items): qty, sales, client cut, GS gross', build: buildPackageSales },
  { key: 'top-customers', label: 'Top customers', group: 'Customers', subtitle: 'Visits, amount collected and last visit per customer', build: buildTopCustomers },
  { key: 'cash-flow', label: 'Cash flow', group: 'Operations', subtitle: 'Money in from clients vs money out to agents', build: buildCashFlow },
  { key: 'settlements', label: 'Settlements', group: 'Operations', subtitle: 'Every recorded payment, in and out', build: buildSettlements },
]

export const REPORT_GROUPS = [...new Set(REPORTS.map((r) => r.group))].map((group) => ({
  group,
  reports: REPORTS.filter((r) => r.group === group),
}))
