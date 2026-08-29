import GroupedLedgerView from '../components/GroupedLedgerView'

const groupOf = (o) => ({
  key: o.agent?.id ?? 'none',
  label: o.agent?.full_name ?? '— No agent —',
})

// "Agent cut" column = what each agent has earned / is owed on confirmed orders.
export default function AgentLedger() {
  return (
    <GroupedLedgerView
      title="Agent Ledger"
      noun="agent"
      firstColHeader="Agent"
      groupOf={groupOf}
      fileSlug="agent_ledger"
      payoutParty="agent"
    />
  )
}
