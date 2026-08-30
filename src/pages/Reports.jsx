import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { FileBarChart, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/useAuth'
import { LEDGER_SELECT } from '../lib/ledger'
import { REPORTS, REPORT_GROUPS } from '../lib/reports'
import ReportView from '../components/reports/ReportView'
import './reports.css'

const PAYOUT_SELECT =
  'id, party, client_id, agent_id, amount, paid_on, method, note, client:client_id ( company_name ), agent:agent_id ( full_name )'

export default function Reports() {
  const { can, isSuperAdmin } = useAuth()
  const canView = isSuperAdmin || can('reports', 'view')

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeKey, setActiveKey] = useState(REPORTS[0].key)
  const [q, setQ] = useState('')

  const fetchAll = useCallback(async () => {
    const [orders, payouts, customers, clients, accounts] = await Promise.all([
      supabase.from('orders').select(`${LEDGER_SELECT}, customer_id, scheduled_date, scheduled_time, branch_id`),
      supabase.from('payouts').select(PAYOUT_SELECT),
      supabase.from('customers').select('id, ref_no, full_name, phone, source, created_at'),
      supabase.from('clients').select('id, ref_no, company_name, status, created_at'),
      supabase.from('accounts').select('id, ref_no, name, location, manager:manager_id ( full_name )'),
    ])
    if (orders.error) toast.error('Could not load report data')
    setData({
      orders: orders.data ?? [],
      payouts: payouts.data ?? [],
      customers: customers.data ?? [],
      clients: clients.data ?? [],
      accounts: accounts.data ?? [],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (canView) fetchAll()
  }, [canView, fetchAll])

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return REPORT_GROUPS
    return REPORT_GROUPS.map((g) => ({
      ...g,
      reports: g.reports.filter(
        (r) => r.label.toLowerCase().includes(s) || r.subtitle.toLowerCase().includes(s),
      ),
    })).filter((g) => g.reports.length)
  }, [q])

  const active = REPORTS.find((r) => r.key === activeKey) ?? REPORTS[0]

  if (!canView) {
    return (
      <div className="page">
        <div className="card placeholder-card">
          <FileBarChart size={28} color="var(--muted)" />
          <h2>No access</h2>
          <p>You don&rsquo;t have permission to view Reports.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle">{REPORTS.length} reports · pick one on the left</p>
        </div>
      </div>

      <div className="rp-layout">
        <div className="rp-list">
          <div className="rp-search">
            <label className="filter-search">
              <Search size={13} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a report" />
            </label>
          </div>
          {groups.map((g) => (
            <div className="rp-group" key={g.group}>
              <div className="rp-group-label">{g.group}</div>
              {g.reports.map((r) => (
                <button
                  key={r.key}
                  className={`rp-item${activeKey === r.key ? ' on' : ''}`}
                  onClick={() => setActiveKey(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="rp-none">No matching report</div>}
        </div>

        <div className="rp-panel">
          {loading || !data ? (
            <div className="rp-loading">Loading report data…</div>
          ) : (
            <ReportView key={active.key} report={active} data={data} />
          )}
        </div>
      </div>
    </div>
  )
}
