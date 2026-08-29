import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Coins, Download, HandCoins, RefreshCw, ScrollText, Tag, TrendingUp, Users, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { fmtMoney } from '../lib/format'
import { LEDGER_SELECT, ZERO_TOTALS, addTotals } from '../lib/ledger'
import { rangeFrom } from '../lib/filters'
import { downloadCsv, toCsv } from '../lib/csv'
import RangeTabs from './RangeTabs'
import SettlementModal from './SettlementModal'
import DataTable from './data/DataTable'
import FilterBar from './data/FilterBar'
import StatCards from './data/StatCards'

// Groups every CONFIRMED order by `groupOf(order) -> { key, label, sub? }` and
// sums Sales / Discount / Gross / Client / Agent / Net per group. Shared by the
// Account / Agent / Client / Package finance ledgers.
export default function GroupedLedgerView({
  title,
  noun,
  firstColHeader,
  groupOf,
  fileSlug,
  payoutParty, // 'agent' | 'client' | undefined  -> adds Owed / Paid / Outstanding
}) {
  const { can, profile } = useAuth()
  const canView = can('finance', 'view')
  const canSettle = Boolean(payoutParty) && can('finance', 'add')

  const [orders, setOrders] = useState([])
  const [paidByKey, setPaidByKey] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [settle, setSettle] = useState(null) // group row to settle | null
  const [range, setRange] = useState('all')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [lossOnly, setLossOnly] = useState(false)

  const fetchRows = useCallback(async () => {
    const [{ data, error }, pay] = await Promise.all([
      supabase.from('orders').select(LEDGER_SELECT).eq('status', 'confirmed'),
      payoutParty
        ? supabase.from('payouts').select('party, client_id, agent_id, amount').eq('party', payoutParty)
        : Promise.resolve({ data: [] }),
    ])
    if (error) toast.error('Could not load the ledger')
    setOrders(data ?? [])
    const m = new Map()
    for (const p of pay.data ?? []) {
      const k = payoutParty === 'agent' ? p.agent_id : p.client_id
      m.set(k, (m.get(k) ?? 0) + Number(p.amount))
    }
    setPaidByKey(m)
    setLoading(false)
  }, [payoutParty])

  useEffect(() => {
    if (canView) fetchRows()
  }, [canView, fetchRows])

  const groups = useMemo(() => {
    const map = new Map()
    const rFrom = rangeFrom(range)
    for (const o of orders) {
      const d = o.confirmed_at || o.created_at
      if (rFrom && d < rFrom) continue
      if (from && d < from) continue
      if (to && d > `${to}T23:59:59`) continue
      const g = groupOf(o)
      const cur = map.get(g.key) ?? { key: g.key, label: g.label, sub: g.sub, totals: { ...ZERO_TOTALS } }
      cur.totals = addTotals(cur.totals, o)
      map.set(g.key, cur)
    }
    let list = [...map.values()].map((g) => {
      // client -> money the client OWES us (gsNet); agent -> money WE owe the agent
      const owed = payoutParty === 'agent' ? g.totals.agent : payoutParty === 'client' ? g.totals.gsNet : 0
      const paid = paidByKey.get(g.key) ?? 0
      return {
        id: g.key,
        label: g.label,
        sub: g.sub,
        ...g.totals,
        owed,
        paid,
        outstanding: owed - paid,
      }
    })
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((g) => `${g.label} ${g.sub ?? ''}`.toLowerCase().includes(q))
    if (lossOnly) list = list.filter((g) => g.net < 0)
    return list.sort((a, b) => b.net - a.net)
  }, [orders, range, from, to, search, lossOnly, groupOf, payoutParty, paidByKey])

  const grand = useMemo(
    () =>
      groups.reduce(
        (a, g) => ({
          orders: a.orders + g.orders,
          sales: a.sales + g.sales,
          discount: a.discount + g.discount,
          client: a.client + g.client,
          gsGross: a.gsGross + g.gsGross,
          gsNet: a.gsNet + g.gsNet,
          agent: a.agent + g.agent,
          net: a.net + g.net,
          owed: a.owed + g.owed,
          paid: a.paid + g.paid,
          outstanding: a.outstanding + g.outstanding,
        }),
        { ...ZERO_TOTALS, owed: 0, paid: 0, outstanding: 0 },
      ),
    [groups],
  )

  // client owes us -> "Receivable / Received"; we owe the agent -> "Owed / Paid"
  const owedLabel = payoutParty === 'client' ? 'Receivable' : 'Owed'
  const paidLabel = payoutParty === 'client' ? 'Received' : 'Paid'

  const activeFilters = (from ? 1 : 0) + (to ? 1 : 0) + (lossOnly ? 1 : 0)
  const clearFilters = () => {
    setFrom('')
    setTo('')
    setSearch('')
    setLossOnly(false)
    setRange('all')
  }

  const exportCsv = () => {
    const headers = [
      { key: 'label', label: firstColHeader },
      { key: 'orders', label: 'Orders' },
      { key: 'sales', label: 'Sales' },
      { key: 'client', label: 'Client cut' },
      { key: 'gsGross', label: 'GS gross' },
      { key: 'discount', label: 'Discount' },
      { key: 'gsNet', label: 'GS net' },
      { key: 'agent', label: 'Agent cut' },
      { key: 'net', label: 'Net' },
      ...(payoutParty
        ? [
            { key: 'owed', label: owedLabel },
            { key: 'paid', label: paidLabel },
            { key: 'outstanding', label: 'Outstanding' },
          ]
        : []),
    ]
    const line = (g) => ({
      label: g.label === 'TOTAL' ? 'TOTAL' : g.sub ? `${g.label} (${g.sub})` : g.label,
      orders: g.orders,
      sales: fmtMoney(g.sales),
      client: fmtMoney(g.client),
      gsGross: fmtMoney(g.gsGross),
      discount: fmtMoney(g.discount),
      gsNet: fmtMoney(g.gsNet),
      agent: fmtMoney(g.agent),
      net: fmtMoney(g.net),
      owed: fmtMoney(g.owed),
      paid: fmtMoney(g.paid),
      outstanding: fmtMoney(g.outstanding),
    })
    const rows = groups.map(line)
    rows.push(line({ ...grand, label: 'TOTAL' }))
    downloadCsv(`${fileSlug}_${new Date().toISOString().slice(0, 10)}.csv`, toCsv(headers, rows))
    toast.success(`Exported ${groups.length} ${noun}(s)`)
  }

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <ScrollText size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view the Finance section.</p>
        </div>
      </div>
    )
  }

  const columns = [
    {
      key: 'label',
      header: firstColHeader,
      render: (g) => (
        <div className="stack">
          <span className="primary">{g.label}</span>
          {g.sub && <span className="secondary">{g.sub}</span>}
        </div>
      ),
    },
    { key: 'orders', header: 'Orders', align: 'right', render: (g) => g.orders },
    { key: 'sales', header: 'Sales', align: 'right', render: (g) => fmtMoney(g.sales) },
    { key: 'client', header: 'Client cut', align: 'right', render: (g) => fmtMoney(g.client) },
    { key: 'gsGross', header: 'GS gross', align: 'right', render: (g) => fmtMoney(g.gsGross) },
    { key: 'discount', header: 'Discount', align: 'right', render: (g) => fmtMoney(g.discount) },
    { key: 'gsNet', header: 'GS net', align: 'right', render: (g) => fmtMoney(g.gsNet) },
    { key: 'agent', header: 'Agent cut', align: 'right', render: (g) => fmtMoney(g.agent) },
    {
      key: 'net',
      header: 'Net',
      align: 'right',
      render: (g) => (
        <b style={{ color: g.net < 0 ? 'var(--danger)' : 'var(--accent)' }}>{fmtMoney(g.net)}</b>
      ),
    },
    ...(payoutParty
      ? [
          { key: 'owed', header: owedLabel, align: 'right', render: (g) => fmtMoney(g.owed) },
          { key: 'paid', header: paidLabel, align: 'right', render: (g) => fmtMoney(g.paid) },
          {
            key: 'outstanding',
            header: 'Outstanding',
            align: 'right',
            render: (g) => (
              <b style={{ color: g.outstanding > 0 ? 'var(--warning)' : 'var(--muted)' }}>
                {fmtMoney(g.outstanding)}
              </b>
            ),
          },
        ]
      : []),
    ...(canSettle
      ? [
          {
            key: 'action',
            header: 'Action',
            align: 'right',
            render: (g) =>
              g.id === 'none' ? null : (
                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                  <button title={`Settle with ${g.label}`} onClick={() => setSettle(g)}>
                    <HandCoins size={13} />
                  </button>
                </div>
              ),
          },
        ]
      : []),
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">
            {groups.length} {noun}(s) · {grand.orders} confirmed order(s)
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
          { key: 'd', label: 'Discount', value: fmtMoney(grand.discount), icon: Tag },
          { key: 'gn', label: 'GS net', value: fmtMoney(grand.gsNet), icon: Wallet },
          { key: 'a', label: 'Agent payable', value: fmtMoney(grand.agent), icon: Users },
          { key: 'n', label: 'Net', value: fmtMoney(grand.net), icon: Wallet },
          ...(payoutParty
            ? [
                { key: 'paid', label: paidLabel, value: fmtMoney(grand.paid), icon: Wallet },
                { key: 'out', label: 'Outstanding', value: fmtMoney(grand.outstanding), icon: Wallet },
              ]
            : []),
        ]}
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder={`Search ${noun}...`}
        activeCount={activeFilters}
        onClear={clearFilters}
        inline={
          <label className="check-line">
            <input type="checkbox" checked={lossOnly} onChange={(e) => setLossOnly(e.target.checked)} />
            Losses only
          </label>
        }
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
        rowClassName={(g) => (g.net < 0 ? 'row-loss' : '')}
        loading={loading}
        emptyLabel="No confirmed orders in this period"
        title={firstColHeader}
        subtitle={`${groups.length} · grand total Net ${fmtMoney(grand.net)}`}
      />

      {settle && (
        <SettlementModal
          locked
          preset={{
            party: payoutParty,
            partyId: settle.id,
            partyName: settle.label,
            amount: settle.outstanding,
          }}
          createdBy={profile?.id}
          onClose={() => setSettle(null)}
          onDone={() => {
            setSettle(null)
            fetchRows()
          }}
        />
      )}
    </div>
  )
}
