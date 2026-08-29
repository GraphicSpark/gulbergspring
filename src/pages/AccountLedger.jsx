import GroupedLedgerView from '../components/GroupedLedgerView'

const groupOf = (o) => ({
  key: o.account?.id ?? 'none',
  label: o.account?.name ?? '— Unassigned —',
  sub: o.account?.manager?.full_name ?? null,
})

export default function AccountLedger() {
  return (
    <GroupedLedgerView
      title="Account Ledger"
      noun="account"
      firstColHeader="Account"
      groupOf={groupOf}
      fileSlug="account_ledger"
    />
  )
}
