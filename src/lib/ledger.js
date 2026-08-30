// Shared query + math for the Finance section.
// Only CONFIRMED orders carry a frozen split, so the ledgers work off them.
//
// MONEY FLOW: the customer pays the CLIENT in cash (list price minus discount).
// The client keeps its own cut (fixed, or % of SALES - the discount is
// GraphicSpark's concession and never touches the client). The client then
// OWES GraphicSpark the rest.
//
//   Sales      = package list price (before discount)
//   Client cut = fixed Rs, or % of Sales   -> the client keeps this
//   GS gross   = Sales - Client cut         -> GraphicSpark's margin, pre-discount
//   Discount   = per-order discount          -> GraphicSpark absorbs this
//   GS net     = GS gross - Discount         -> what the client owes GraphicSpark
//   Agent cut  = fixed Rs, or % of GS net    -> GraphicSpark pays the agent this
//   Net        = GS net - Agent cut          -> what GraphicSpark keeps
//
//   (collected = Sales - Discount = what the customer actually hands the client)

export const LEDGER_SELECT = `
  id, ref_no, created_at, confirmed_at, status,
  list_amount, amount, discount_kind, discount_value,
  client_kind, client_value, client_amount,
  agent_kind, agent_value, agent_amount, company_amount,
  package_name, service,
  order_items ( package_id, package_name, unit_price, qty, line_total, client_kind, client_value ),
  account:account_id ( id, ref_no, name, manager:manager_id ( full_name ) ),
  customer:customer_id ( ref_no, full_name ),
  client:client_id ( id, ref_no, company_name ),
  branch:branch_id ( branch_name, city ),
  agent:agent_id ( id, full_name )
`

// A line's client cut - mirrors confirm_order()'s per-line SQL.
// Fixed cut is per unit (× qty); a % is charged on the line's list total.
export function lineClientCut(item) {
  const total = Number(item.line_total ?? (Number(item.unit_price) || 0) * (Number(item.qty) || 1))
  const val = Number(item.client_value) || 0
  return item.client_kind === 'percent'
    ? Math.round(total * val) / 100
    : val * (Number(item.qty) || 1)
}

// "Massage x2, Facial" - the package summary shown in tables / CSV / search.
export function packageSummary(o) {
  const items = o.order_items ?? []
  if (items.length === 0) return o.package_name || o.service || '—'
  return items
    .map((i) => `${i.package_name}${Number(i.qty) > 1 ? ` x${i.qty}` : ''}`)
    .join(', ')
}

export function ledgerAmounts(o) {
  const sales = Number(o.list_amount ?? o.amount ?? 0)
  const collected = Number(o.amount ?? 0)
  const discount = Math.max(sales - collected, 0)
  const client = Number(o.client_amount ?? 0)
  const gsGross = sales - client
  const gsNet = collected - client // = gsGross - discount; what the client owes us
  const agent = Number(o.agent_amount ?? 0)
  const net = Number(o.company_amount ?? 0)
  return { sales, collected, discount, client, gsGross, gsNet, agent, net }
}

export const ZERO_TOTALS = {
  orders: 0,
  sales: 0,
  collected: 0,
  discount: 0,
  client: 0,
  gsGross: 0,
  gsNet: 0,
  agent: 0,
  net: 0,
}

export function addTotals(acc, o) {
  const a = ledgerAmounts(o)
  return {
    orders: acc.orders + 1,
    sales: acc.sales + a.sales,
    collected: acc.collected + a.collected,
    discount: acc.discount + a.discount,
    client: acc.client + a.client,
    gsGross: acc.gsGross + a.gsGross,
    gsNet: acc.gsNet + a.gsNet,
    agent: acc.agent + a.agent,
    net: acc.net + a.net,
  }
}
