// Temporary stand-in for sections built in the next phase.
export default function ComingSoon({ title }) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">This section is being built.</p>
        </div>
      </div>
      <div className="card placeholder-card">
        <span className="placeholder-badge">Coming soon</span>
        <h2>{title}</h2>
        <p>Nothing to show here yet.</p>
      </div>
    </div>
  )
}
