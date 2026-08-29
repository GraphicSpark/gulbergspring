import GroupedLedgerView from '../components/GroupedLedgerView'

// group by the package NAME snapshotted on the order (stable even if the
// package row was later renamed / deleted).
const groupOf = (o) => {
  const name = o.package_name || o.service || '— No package —'
  return { key: name, label: name }
}

export default function PackagePerformance() {
  return (
    <GroupedLedgerView
      title="Package Performance"
      noun="package"
      firstColHeader="Package"
      groupOf={groupOf}
      fileSlug="package_performance"
    />
  )
}
