import { useState } from 'react'
import { useAuth } from '../context/useAuth'
import RangeTabs from '../components/RangeTabs'
import { DATE_RANGES } from '../lib/filters'

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function Dashboard() {
  const { profile } = useAuth()
  const [range, setRange] = useState('all')
  const firstName = profile?.full_name?.trim().split(/\s+/)[0]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="page-subtitle">Welcome to the GraphicSpark CRM portal.</p>
        </div>
      </div>

      <RangeTabs
        label="Showing"
        options={DATE_RANGES}
        value={range}
        onChange={setRange}
      />

      <div className="card placeholder-card">
        <span className="placeholder-badge">Coming soon</span>
        <h2>Dashboard</h2>
        <p>
          Key metrics, recent activity and reports will live here once the other
          sections are in place.
        </p>
      </div>
    </div>
  )
}
