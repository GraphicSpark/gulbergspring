import GroupedLedgerView from '../components/GroupedLedgerView'

const groupOf = (o) => ({
  key: o.client?.id ?? 'none',
  label: o.client?.company_name ?? '— Unknown client —',
})

// "Client cut" column = what each client (spa) has earned / is owed on confirmed orders.
export default function ClientLedger() {
  return (
    <GroupedLedgerView
      title="Client Ledger"
      noun="client"
      firstColHeader="Client"
      groupOf={groupOf}
      fileSlug="client_ledger"
      payoutParty="client"
    />
  )
}
