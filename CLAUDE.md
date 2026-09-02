# GraphicSpark CRM - Project Context

## Overview
A **spa referral business** CRM. GraphicSpark sends walk-in **customers** to
**client** spas (companies with branches) and keeps a margin per **order**.
Every order picks one of the client's **packages**. Money flow (P&L per order):

    Sales     = package list price
    Client cut= fixed Rs, or % of SALES   -> the client keeps this
    GS gross  = Sales - Client cut         -> GraphicSpark's margin (pre-discount)
    Discount  = optional per-order discount -> GraphicSpark absorbs it (client untouched)
    GS net    = GS gross - Discount         -> what the CLIENT OWES GraphicSpark
    Agent cut = fixed Rs, or % of GS net   -> GraphicSpark PAYS the agent this
    Net       = GS net - Agent cut          -> what GraphicSpark keeps

**The customer pays the CLIENT in cash at the spa** (`amount` = Sales - Discount).
GraphicSpark never pays the client - it *collects from* the client (GS net) and
*pays* the agent. The split is frozen when the order is **confirmed**
(`orders.confirm`). `confirm_order()` stores `client_amount` (Client cut),
`agent_amount` (Agent payable), `company_amount` (= Net); GS gross / GS net are
derived. Legacy note: `client_kind/value` snapshot is per package; % is on SALES
(`019_confirm_order_client_pct_on_sales.sql`, was previously on the discounted amount).

GraphicSpark's internal CRM portal. Standalone project, **completely separate** from
BlackDrivo (D:\BlackDrivoAdmin): its own git repo, GitHub remote, Supabase project,
and Vercel project. Do not share keys, tables, or deploy targets with BlackDrivo.
BlackDrivo's Admin UI rules (region-wise pattern, no-icons, etc.) do NOT apply here.

- Folder: `E:\GraphicSparkCRM`  (still `E:\GulbergSPA` until the user renames it)
- GitHub: https://github.com/GraphicSpark/gulbergspring  (remote `origin`; repo kept the old name)
- Supabase: https://fmfbjpblhqgrwqeswztw.supabase.co  (project ref `fmfbjpblhqgrwqeswztw`)

## Stack
- React 19 + Vite (JavaScript / JSX). `recharts` for charts (Dashboard + Agent Performance).
- Route pages are `React.lazy`-loaded (App.jsx); recharts is its own async chunk
  (`BarChart-*.js`) shared by the pages that use it, loaded on first visit.
  `<Suspense>` fallback is inside `Layout` so the sidebar stays put during a page load.
- Supabase: Auth + Postgres + RLS. Client uses the anon key only.
- Deploy: Vercel (separate project)

## Security
- `.env` holds only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (public, gitignored).
- The `service_role` key must NEVER live in this frontend repo, never in a `VITE_` var,
  never committed. Server-only (Supabase Edge Function secrets) if ever needed.
- The service_role key was pasted in a chat - consider rotating it in
  Supabase Dashboard > Settings > API if that exposure is a concern.

## Theme (from https://www.graphicspark.pk/)
Fonts (Google Fonts):
- Headings: **Space Grotesk** (700 for hero, 500/600 for section titles)
- Body / UI: **Inter**

Colors:
- Accent / primary:      `#3471B8`  (blue - primary buttons, links-on-hover, active states)
- Heading text:          `#2D2C2B`
- Body text:             `#727272`
- Muted / secondary:     `#80858F`
- Dark:                  `#262B35`  (reserved for dark text / accents - NOT the sidebar)
- Page background:       `#FFFFFF`
- Light surface:         `#F8F9FA` / `#F7F7F7`
- Border:                `#E4E4E4`

Shape:
- Primary CTA buttons: full pill (`border-radius: 50px`)
- Form / inline buttons: small radius (`4-5px`)
- Logo file: `public/GSlogo.png` (horizontal lockup: blue GS mark + wordmark on a
  `#E6E6E6` ground). Favicon: `public/favicon.svg` + `public/apple-touch-icon.png`.

## UI conventions (modelled on the BlackDrivo admin - https://admin.blackdrivo.com/)
Reference source (read-only, for style only): `D:\BlackDrivoAdmin\src`.

- **FLAT - no card containers.** Page content sits directly on the white page.
  NO bordered/shadowed boxes wrapping stats, filters, tables or form sections.
  Separate blocks with a heading + a `1px var(--border)` hairline rule and
  whitespace. `.card` is a deliberate no-op class. (This overrides BlackDrivo,
  which is card-heavy.) Modals are the only panels (they float over a backdrop).

- **Modals / forms** all use `src/components/Modal.jsx`. It closes ONLY via the
  X button or Esc - a backdrop click does nothing, so a stray click while filling
  a form never discards input. Keep it that way for any new form/modal.
  **Never use `window.confirm` / `alert`** - use `src/components/ConfirmDialog.jsx`
  (a plain Yes/Cancel popup) or an inline confirm strip (`.confirm-inline`, e.g. the
  Order detail modal's Confirm / Cancel). `ConfirmDelete.jsx` = the type-DELETE variant.

- **Left sidebar: LIGHT, not dark.** White background, `border-right`, a `#E6E6E6`
  brand strip at the top holding `GSlogo.png`. Nav is split into labelled sections
  ("Records", "Administration", "Account") with 10px uppercase section labels and a
  `border-top` between sections.
  Active / hover nav item = **accent text + a 3px accent bar on the left edge**.
  NO filled "pill" background on the active item. lucide icons at `size={17}`.
  Component: `src/components/Sidebar.jsx` + `src/components/layout.css`.
- **Date / range filters** (dashboard, all Finance ledgers + Settlements): flat
  **underline tabs** - "All / Today / Week / Month", active tab has a 2px accent
  bottom-border. **Do NOT use pill-shaped filter chips.** Component:
  `src/components/RangeTabs.jsx`; `src/lib/filters.js` has `DATE_RANGES` +
  `rangeFrom(key)` -> a 'YYYY-MM-DD' lower bound (Monday week start; '' = all).
  Ledgers apply it on top of their custom From/To (intersection).
- The full-pill radius stays for real CTA buttons only (`.btn`).

## CRM Portal Structure
Auth-gated. Supabase Auth login screen -> portal. No public sign-up - internal
users are created by an admin only.

No topbar bar - just a floating **profile chip** at top-right: avatar +
name + role (role hidden on mobile), chevron, and a dropdown (Profile link,
Logout). On mobile a hamburger (top-left) opens the sidebar drawer.
Component: `src/components/Topbar.jsx`.

Left sidebar menu (grouped into sections - see UI conventions below):
- (top)            Dashboard      - KPI cards (sparkline + vs-previous-period delta chip, NOT
                    clickable) in Performance / Cash & collections / Breakdown / Bookings &
                    customers / Activity sections. Range control `DASH_RANGES`
                    (All / Today / 7d / 30d / 90d / This month / This quarter / YTD / Custom
                    w/ two date inputs); `rangeWindow(key, custom)` -> `{from,to}`. Charts
                    (recharts): sales/net area trend, forecast (run-rate to month/quarter/year
                    end), status & money-split & new-vs-returning donuts, cash-flow composed
                    (in/out bars + net line), receivables aging (FIFO per client, 0-30/31-60/
                    61-90/90+), top accounts/clients/agents/packages bars, conversion funnel,
                    weekday-x-slot heatmap (CSS grid), appointments-by-weekday. Activity lists.
                    Money KPIs/charts only for `finance.view`. `src/lib/dashboard.js` does all
                    the aggregation; `src/pages/Dashboard.jsx` + `dashboard.css`.
                    Always visible (`dashboard` perm just gates the nav row).
- Records:         Clients        - spa companies + their branches
- Records:         Packages       - per-client service "menu"; each package has its own
                    rate (fixed Rs / % of order). Rate changes are logged. Nav-gated on
                    `packages.view`, edits on `packages.edit`.
- Records:         Customer       - walk-in customers
- Records:         Orders         - customer -> client referral; every order picks a package
                    AND an account
- Account:         Accounts       - internal business units; every order is attributed to one.
                    Account name + Account Manager (internal user) + Location. Admins manage;
                    others get view.
- Finance:         Financial Ledger - one dense row per CONFIRMED order, the P&L chain:
                    **Sales - Client cut = GS gross ; GS gross - Discount = GS net (client
                    owes us) ; GS net - Agent cut = Net.** + Account/Customer/Client/Package/
                    Agent. Loss rows (net < 0) flagged red + "Losses only" filter. Summary
                    cards = totals. CSV export. Gated on `finance`.
- Finance:         Account / Agent / Client Ledger - the same numbers grouped/summed (shared
                    `src/components/GroupedLedgerView.jsx`, one whole order per row).
                    **Agent Ledger** adds Owed / Paid / Outstanding (we owe the agent).
                    **Client Ledger** adds Receivable / Received / Outstanding (client owes us).
                    Both have a per-row **Settle** button (`finance.add`) -> `<SettlementModal>`
                    (`src/components/SettlementModal.jsx`) pre-filled to that party + outstanding,
                    writes to `payouts`, refreshes.
- Performance:     Package Performance (`src/pages/PackagePerformance.jsx`, standalone - NOT
                    GroupedLedgerView) - confirmed orders EXPLODED into `order_items`, grouped
                    by package name: Orders / Qty sold / Sales / Client cut / GS gross (all
                    line-level). No Agent cut / Net (those are order-level). Gated `performance`.
- Performance:     Agent Performance (`src/pages/AgentPerformance.jsx`) - per-agent productivity
                    from ALL orders (not just confirmed): Orders / Confirmed / Conversion %
                    (confirmed / (confirmed+cancelled)) / Packages sold / Sales / GS net /
                    Commission earned / Avg order value / Company net. recharts leaderboard
                    (metric switch: net/commission/sales/orders) + stacked orders-by-status
                    bar. RangeTabs + date range + CSV. Gated `performance`.
- Finance:         Settlements (`src/pages/Settlements.jsx`) - record money IN from a client or
                    money OUT to an agent (type / who / amount / date / method / note).
                    Add/edit/delete need `finance.add|edit|delete` (admin only). Feeds the
                    ledgers' Received/Paid columns. Backed by the `payouts` table (party
                    'client' = money in, 'agent' = money out).
                    `src/lib/ledger.js` = `LEDGER_SELECT` (embeds `order_items`) + `ledgerAmounts`
                    (sales/client/gsGross/discount/gsNet/agent/net) + `addTotals` +
                    `lineClientCut(item)` + `packageSummary(order)`.
- Reports:         Reports (`src/pages/Reports.jsx`) - left panel of grouped report names +
                    `<ReportView>` (`src/components/reports/ReportView.jsx`): RangeTabs
                    (+ custom dates) / KPI cards / optional recharts chart / dense table /
                    CSV export. Catalogue = `src/lib/reports.js` `REPORTS` (each a pure
                    `build({orders,payouts,customers,clients,accounts,from,to}) -> {kpis,
                    columns,rows,filename,chart?}`). v1 (11): P&L summary, Sales trend,
                    Discounts given, Order status, Client report, Agent report, Account report,
                    Package sales, Top customers, Cash flow, Settlements. Page fetches
                    orders/payouts/customers/clients/accounts once; each report also needs that
                    table's own `*.view` RLS. Gated `reports`.
- Administration:  User Management - internal staff list; Super Admin / Admin can
                    CREATE users, everyone else is read-only (view the user table)
- Administration:  Role Access    - permission matrix per role + custom-role CRUD
                    (**+ New role**, rename, delete on non-system rows). By Role / By User
                    modes. Managed by Super Admin only. `src/lib/roles.js` = fetch/CRUD.
- Account:         Profile        - separate page; the logged-in user edits their own info

Each item is permission-gated: hidden unless the user has the matching `*.view`
permission (Role Access is super_admin only; Dashboard/Profile always shown).

## Roles  (custom roles + multi-role - migration `020_custom_roles_multi_role.sql`)
- `public.roles (key, label, is_system, sort)` - 4 system rows (`super_admin`, `admin`,
  `agent`, `ops`, `is_system=true`, protected by `trg_roles_protect`) + any custom rows
  a Super Admin adds on the Role Access page. `user_role` enum still exists (it types
  `profiles.role`) but is no longer the source of truth for permissions.
- `public.user_roles (user_id, role)` - **a user can hold several roles** and gets the
  **UNION** of everything any of them grants. `role_permissions.role` is now `text` ->
  `roles.key` (`on delete cascade`, same for `user_roles`).
- `profiles.role` = a **derived "primary" tier** (the most-privileged *system* role the
  user holds, else `agent`), kept in sync by `trg_user_roles_sync` (`sync_primary_role()`,
  AFTER INSERT/DELETE on `user_roles`). It drives `current_user_role()` / `is_admin()` /
  the super-admin bypass and every existing policy - so those needed **no change**.
- Custom roles only ever grant explicit page x action perms; the `is_admin()` RLS bypass
  stays tied to the built-in `admin` / `super_admin` only.
- Super Admin: everything, bypasses every permission check.
- Admin: `is_admin()` in RLS; broad defaults incl. user management.
- Everyone else: the union of their roles' Role Access grants (+ per-user overrides).
The UI reads permissions (never hard-codes role checks) except the super_admin bypass.
`AuthContext` exposes `roles` (string[]) alongside `profile`.

## Permission model - page x action, role-wise + user-wise (migration 2026-08-27)
- **Pages**: `dashboard` (view), `clients`, `packages`, `customers`, `orders`, `accounts`,
  `finance`, `performance` (view), `reports` (view), `users` (view/add/edit/delete), `roles` (view/edit).
  `orders` also has `confirm`. `finance` add/edit/delete gate the Settlements page only (the
  ledgers are view-only). `performance` (view) gates the Performance section and `reports`
  (view) gates the Reports page - those pages read `orders` / `payouts` / `customers` /
  `clients` / `accounts`, so such a role also needs those tables' own `*.view`.
  Catalogue: `src/lib/permissions.js` (`PERMISSION_PAGES`).
  On the `users` page, `delete` = "deactivate". `perm_action` enum now includes `confirm`.
- **RULE - EVERY new navigable page/section gets a Role Access row.** Adding a page =
  (1) add to `PERMISSION_PAGES` (with its `group` = the sidebar section label),
  (2) gate the nav item (`Sidebar.jsx` `page:`) + the page component with `can('<key>', ...)`,
  (3) point any table RLS it needs at `has_perm('<key>', ...)`. `role_permissions` seeding
  is optional (an unseeded page defaults to denied for non-super roles until a Super Admin
  toggles it), but seed the built-in `admin` row so plain admins keep access - see
  `022_performance_permission.sql`. Only Profile is exempt.
- `role_permissions (role text -> roles.key, page, action, allowed)` - per-role grants
- `user_permissions (user_id, page, action, allowed)` - per-user override (wins outright)
- `private.has_perm(page text, action perm_action)`: super_admin -> true; else user
  override; else `bool_or(allowed)` across the caller's `user_roles`; else false.
- `AuthContext.can(page, action)` is the single client gate; it loads
  `role_permissions` for **every** role in `user_roles` and OR-combines them. RLS on
  clients/customers/orders/client_branches (-> `clients`), client_packages + the package log
  (-> `packages`), accounts (-> `accounts`), payouts (-> `finance`) all call `has_perm`.
  **Exception (024):** `accounts` + `client_packages` SELECT also allow `orders.view` -
  the Add/Edit Order form needs those lists even for an agent who can't see the
  Accounts / Packages pages. Nav gating in the UI is unchanged.
- Role Access page: **By Role** (also creates/renames/deletes custom roles) and
  **By User** (override one person; role default = union of their roles). Writes are
  super_admin-only (RLS `rp_super_admin` / `up_super_admin` / `roles_super` / `ur_super`).

## Edge Function `admin-users` - DEPLOYED to fmfbjpblhqgrwqeswztw (v6, 2026-08-30)
`supabase/functions/admin-users/index.ts`. The ONLY place the service_role key
is used (Supabase injects it - no secret to configure). verify_jwt on.
Every profile mutation for OTHER users goes through it. Actions:
- `create`      { full_name, email, phone, roles:string[], password }      - needs `users.add`
- `update`      { user_id, full_name?, phone?, roles?:string[], commission_kind?, commission_value?, commission_active? } - `users.edit`
- `set_password`{ user_id, password }                                      - needs `users.edit`
- `set_active`  { user_ids[], active }                                     - `users.edit` on / `users.delete` off
`roles[]` is validated against `public.roles` and written to `user_roles` (create =
insert; update = replace-all). Legacy `role` (singular) still accepted as `[role]`.
`profiles.role` is set by the DB trigger, not by this function. Non-super callers
cannot touch or grant `super_admin`/`admin`. Client wrapper: `src/lib/adminUsers.js`.
The user logs in with the password set at create time.

## Data model - Supabase (see /supabase/*.sql)
- **Gotcha fixed 2026-08-27** (`003_grants.sql`): tables made via MCP migrations
  get NO `anon/authenticated/service_role` grants (Supabase auto-grant only fires
  for role `postgres`), so every REST call 403'd. Any NEW table needs
  `grant select,insert,update,delete on <t> to authenticated, service_role;`
  (default privileges are now set, but only for the migration-runner role).

- `profiles`         - 1:1 with auth.users; full_name, email, phone, role (DERIVED primary
                        tier - see Roles), avatar_url, is_active
- `roles`            - (key, label, is_system, sort) role catalogue; 4 system rows +
                        Super-Admin-added custom rows. `trg_roles_protect` blocks deleting /
                        re-keying system rows. [020_custom_roles_multi_role.sql]
- `user_roles`       - (user_id, role -> roles.key) many-to-many; a user's permissions are
                        the UNION over these. `trg_user_roles_sync` keeps `profiles.role`
                        = most-privileged system role held (else 'agent').
- `clients`          - the company: company_name, status (active|lead|inactive), notes, created_by
- `client_branches`  - (client_id, branch_name, city, poc_name, poc_phone, poc_email, address,
                        is_primary)  [new 2026-08-27, `004_client_branches.sql`; clients lost
                        contact_person/email/phone/address/city]. One primary branch per client
                        (partial unique index). RLS follows the `clients` page permission.
- **Display IDs**: ONE shared sequence `public.ref_no_seq` (starts 1001) feeds `ref_no bigint`
  on customers / clients / orders / client_packages / accounts / payouts - the next record created gets the next
  number, regardless of type (order 1004 -> package 1005 -> client 1006). ref_no is
  display-only (no FK uses it), shown as a plain number with no leading '#'.
  [010_shared_ref_no_sequence.sql, replaced the per-table identity sequences]
- `customers`        - ref_no, full_name, phone, email, gender, dob, address, source, notes
- `accounts`         - ref_no, name, manager_id (-> profiles), location, created_by. RLS on the
                        `accounts` page permission. [013_accounts.sql]
- `orders`           - ref_no, account_id (-> accounts, required in UI), customer_id, client_id,
                        branch_id, agent_id, scheduled_date +
                        scheduled_time (both optional; time is a 30-min slot picked from a
                        grouped popover - `src/components/TimeSlotPicker.jsx`, list in
                        `src/lib/slots.js`),
                        discount_kind ('none'|'fixed'|'percent') + discount_value (ORDER-level),
                        list_amount / amount / package_name / service - all **DERIVED from the
                        line items** (see `order_items` + `recompute_order_from_items`):
                        list_amount = Σ line_total, amount = list_amount - discount (pending
                        only), package_name/service = summary ("Massage x2, Facial").
                        service is now NULLABLE. package_id / client_kind / client_value kept
                        as first-line summary + the confirm_order legacy fallback.
                        status (pending|confirmed|cancelled), + frozen split
                        (client_amount / agent_amount / company_amount) set by `confirm_order()`.
                        The frozen split is NOT shown in the UI (order detail hides it).
                        [005_orders.sql, 007_package_price_discount.sql,
                        012_orders_date_time_slot.sql, 021_order_items_multi_package.sql]
- `order_items`      - **a POS-style line list: one order holds MANY packages.** (order_id,
                        package_id -> client_packages on delete set null, package_name / unit_price
                        / client_kind / client_value = snapshot, qty, line_total = unit_price*qty
                        generated). `trg_order_items_snapshot` fills missing snapshot fields from
                        the package; `trg_order_items_recompute` -> `recompute_order_from_items`
                        re-sums the parent order. RLS follows the `orders` page permission.
                        [021_order_items_multi_package.sql]
- `client_packages`  - ref_no, (client_id, name, price, commission_kind 'fixed'|'percent',
                        commission_value, description (optional free text, "• " bullet lines),
                        is_active). Per-client package menu; `price` is the
                        sticker price that auto-fills the order amount. `commission_*` = the
                        client's cut it KEEPS from the cash for that package. A **% is charged
                        on SALES (the list price), NOT the discounted amount** - the per-order
                        discount is GraphicSpark's concession and never touches the client
                        (fixed is likewise unaffected). Partial unique index on
                        (client_id, lower(name)) where is_active.
                        [006_client_packages.sql, 007_package_price_discount.sql,
                        019_confirm_order_client_pct_on_sales.sql]
- `client_package_log` - append-only; one row per rate change, written by the SECURITY DEFINER
                        trigger `log_client_package_change()` (old/new kind+value + auth.uid()).
- **Order totals from line items**: `trg_orders_snapshot` (BEFORE INSERT/UPDATE) now only
  re-derives `amount` = `list_amount - discount` (floored at 0) + snapshots the agent's
  commission, all *while status='pending'*. The package name/price/rate now live per line in
  `order_items`; `recompute_order_from_items()` (fired by `trg_order_items_recompute`) sums
  the lines into `orders.list_amount` and refreshes `amount` + the `package_name` summary.
  `amount` is always server-derived (the client never sends it). Editing/deactivating a
  package NEVER affects existing orders (each line froze its own rate).
- **`confirm_order()` client cut = Σ per line**: for each `order_items` row, a % client cut
  is charged on that line's `line_total`, a fixed cut is `client_value * qty`; summed into
  `client_amount`. Orders with no lines (pre-021) fall back to the order's frozen
  `client_kind/value`. GS gross / GS net / agent cut / net are unchanged (order-level).
- **Where each cut is configured**: client cut (what the client KEEPS from the cash) -> the
  **package** (Packages page); agent cut (what GraphicSpark PAYS the agent) -> the **agent's
  profile** (User Management -> Edit user), with an on/off switch (`commission_active`);
  GS gross / GS net (what the client OWES GraphicSpark) + net -> automatic, never set by hand.
- `profiles` carries `commission_kind` ('fixed'|'percent') + `commission_value` = the agent's
  cut (fixed Rs, or % of GS net), plus `commission_active` (bool, default true) = an on/off
  switch: when false, `confirm_order()` gives the agent 0 and GraphicSpark keeps the whole cut.
  **All three are read LIVE from `profiles` at confirm time** (`025_...` - previously
  `confirm_order` used the `orders.agent_kind/value` snapshot taken at order-creation, so a
  commission set/changed after an order was created had no effect even on a pending order).
  Setting an agent's commission now flows to every still-pending order; confirmed orders keep
  their frozen split. `orders_snapshot_package` still writes `orders.agent_kind/value` on
  insert but `confirm_order` no longer reads it. [008_agent_commission_toggle.sql,
  025_confirm_order_live_agent_commission.sql]. Non-admins can't change their own commission
  (trg_profiles_protect - role/is_active/commission_kind/value/active).
  `clients.commission_kind/value` columns still exist but are UNUSED by the UI (superseded by
  packages); kept only as the `confirm_order` legacy fallback.
- `role_permissions` - (role text -> roles.key, page, action, allowed)  [020: enum->text+FK]
- `user_permissions` - (user_id, page, action, allowed)  [new 2026-08-27]
- `confirm_order(uuid)` - SECURITY DEFINER RPC, gated by `orders.confirm`, computes + freezes
  the commission split. (Supabase advisor flags it as user-executable - intentional.)
- RLS on all 14 tables (incl. `payouts`, `roles`, `user_roles`). `private` helper fns
  (not REST-exposed): `is_admin()`, `current_user_role()`, `is_active_user()`,
  `has_perm(text, perm_action)` (now ORs over `user_roles`)
- Trigger `on_auth_user_created` auto-inserts a `profiles` row for every new auth user
- Trigger `trg_profiles_protect` blocks role/is_active changes by a logged-in
  non-admin; a service-role connection (auth.uid() null) is allowed through
- Supabase security advisors: clean (one unrelated Auth WARN: leaked-password
  protection is off - optional dashboard toggle)
- MCP access: this Claude connector CAN reach project `fmfbjpblhqgrwqeswztw` via
  `apply_migration` / `execute_sql` (execute_sql runs as read-only user)

## First super_admin - DONE
- `maqboolit@gmail.com` / name "Maqbool Ahmad" / role `super_admin` (created 2026-08-26 as
  `gulbergspring@gmail.com`; email changed to `maqboolit@gmail.com` 2026-08-30 via
  `change_super_admin_email` migration - updated `auth.users` + `auth.identities` +
  `profiles.email`, still email/password provider, password unchanged).
- Note: the `trg_profiles_protect` trigger blocks role changes outside an admin
  session, so seeding roles via SQL needs
  `alter table public.profiles disable trigger trg_profiles_protect;` ... `enable` around it.

## Rename (Gulberg SPA -> GraphicSpark CRM) - 2026-08-26
- [x] App code + docs renamed to "GraphicSpark CRM" (brand shows as "GraphicSpark")
- [ ] Folder: user renames `E:\GulbergSPA` -> `E:\GraphicSparkCRM`, then reopens Claude Code there
- [~] GitHub: repo kept as `gulbergspring` (remote points there; code pushed 2026-08-27)
- [ ] Supabase: user renames project display name in Dashboard (ref `fmfbjpblhqgrwqeswztw` is unchanged)
- Note: first super_admin login is now `maqboolit@gmail.com` (changed from `gulbergspring@gmail.com` 2026-08-30)

## TODO
- [ ] In Supabase Auth settings: turn OFF public sign-up (Authentication > Sign In / Providers)
- [x] `git push` first commit -> origin/main (gulbergspring), 2026-08-27
- [ ] Create Vercel project, link repo
- [x] Build: Supabase client, auth context, protected routes, layout (topbar + sidebar)
- [x] Login page (no sign-up)
- [x] Edge Function `admin-users` - deployed (v3)
- [x] Permission model v2 (page x action, role + user), migrated
- [x] User Management page (`src/pages/Users.jsx`) - list, filters, add/edit/password, activate/deactivate, bulk
- [x] Role Access page (`src/pages/RoleAccess.jsx`) - By Role / By User matrix
- [x] Profile page (`src/pages/Profile.jsx`) - own details + self-service password change (re-auths first)
- [x] Customer page (`src/pages/Customers.jsx`) - View modal (-> Edit), type-DELETE confirm
      (`src/components/ConfirmDelete.jsx`), source + date filters, CSV import (+ sample) / export.
      Fields: Name*, Contact no (phone, **OPTIONAL** everywhere - Add/Edit, Orders quick-add,
      CSV import), Source (optional), Notes?. (email/gender/address DB columns exist but are
      unused in the UI.) `customers.phone` is nullable + has a **partial** unique index
      (`where phone is not null`, 015_customers_phone_unique.sql) - so many phone-less
      customers are fine, but a given number is still one customer. When a phone IS entered
      the Add/Edit form pre-checks + catches 23505; CSV import skips already-registered
      numbers; the Orders quick-add reuses the existing customer. A blank phone skips all that.
- [x] Reusable table kit: `src/components/data/` (DataTable, FilterBar, Pagination, BulkBar, StatCards).
      `<DataTable dense>` = tight spreadsheet rows (~23px) + gridlines + tabular-nums; used by the
      Finance ledgers.
- [x] Clients page (`src/pages/Clients.jsx`) - company list; View modal shows the company
      + its branches (add/edit/delete branch inline, one primary). Add Client creates the
      company + its primary branch in one form. Shows a Packages count column. CSV import
      (row=branch, grouped by company) / export (flattened). No commission fields (-> Packages).
- [x] Packages page (`src/pages/Packages.jsx`) - pick a client -> its package list; add
      unlimited packages, each with a **price** + its own fixed Rs / % client rate + a
      **description** (`<BulletTextarea>` - a "Bullet" button + Enter-continues-list) + active
      toggle. Row actions: History, Edit, **Copy** (duplicate the package to another client -
      original stays), Delete. Select-all + BulkBar: Deactivate / Copy / Delete selected.
      History modal per package (from `client_package_log`). `orders.package_id` is
      `on delete set null`, so deleting a package never errors and existing orders keep their
      frozen rate. Gated on `packages` perm (delete needs `packages.delete`).
- [x] Orders page (`src/pages/Orders.jsx`) - Add order (**Account** * -> Client -> Branch ->
      **Packages** -> Customer; creator = agent). **POS-style multi-package**: `<PackageLines>`
      - search a package, **Add**, each line has a qty −/＋ stepper; "Sales" = running subtotal
      of all lines. A per-order **discount** (none / fixed Rs / %) on that subtotal gives the
      final "customer pays" amount (amount is never typed by hand). Insert is 2-step (order row
      -> `order_items`, order deleted if the items insert fails); Edit replaces `order_items`.
      A client with no active package can't get orders. View modal lists the lines; Confirm
      (orders.confirm) -> `confirm_order` RPC freezes the split (NOT shown); Edit / Cancel while
      pending. `<SearchSelect>` combobox. Table columns:
      ID, Created, Customer, Client, Account, Appt date, Appt time, Packages (summary),
      Sales, **Discount** (always Rs = Sales − Gross, never "10% / off"), Gross, Agent,
      **Agent cut** (`agent_amount` on confirmed orders - shown only to `finance.view` users
      or to the agent on their OWN order; "—" otherwise), Status. Stat cards: Total, Pending,
      Confirmed, Sales, Discount, Gross (last three = Σ over confirmed orders; **Sales** =
      Σ list_amount (before discount), **Gross** = Σ amount (customer pays, after discount),
      **Discount** = Sales − Gross). Main filter row: status, client, account (searchable
      `<SearchSelect>`), "My orders only". Advanced: Created from/to, Appointment from/to,
      Appt time from/to (TimeSlotPicker). CSV **export** via `lib/csv` - Client Gets /
      GraphicSpark Net columns are blank for non-`finance.view` users, Agent Gets only for
      the caller's own orders (same scoping as the table).
- [x] Accounts page (`src/pages/Accounts.jsx`) - internal business units. Add Account:
      name * / Account Manager * (internal-user `<SearchSelect>`) / Location *. Table
      (ID, Account name, Account manager, Location, Added), stat cards (Total, This month),
      searchable Account-name + Account-manager filters + Added date range.
      Gated on the `accounts` permission.
- [x] Finance section (`finance` perm, admin-only): `src/pages/FinancialLedger.jsx` (one row
      per confirmed order - Order/Date/Account/Customer/Package + Sales/Discount/Gross/Client/
      Agent/Net; account + date filters; CSV export) and `src/pages/AccountLedger.jsx` (those
      numbers summed per account + grand-total cards). Shared: `src/lib/ledger.js`. Both
      read-only, no new DB tables - just `orders` where status='confirmed'.
- [x] Agent commission: User (agent) edit form - an on/off checkbox ("This agent earns
      commission on their orders") + type/value; goes through the `admin-users` EF `update`
      action (v5, adds `commission_active`). Client-level commission removed - each package
      carries its own rate.
- [x] Friendly DB errors: `src/lib/errors.js` `dbErrorMessage(error, subject)` maps Postgres
      23503 (FK - row still has orders) / 23505 (duplicate) to a plain sentence. Used in the
      Clients / Customers / Accounts delete handlers (orders reference all three with
      `on delete restrict`).

## Phone numbers - Pakistani mobile only
`src/lib/phone.js` + `src/components/PkPhoneInput.jsx`. UI shows a fixed `+92`
prefix; the user types the 10-digit local part which must match `/^3\d{9}$/`
(starts with 3, exactly 10 digits). Stored as `+923XXXXXXXXX`, displayed as
`+92 3XX XXXXXXX`. CSV import validates phones the same way and skips bad rows.
`customers.phone` is unique (see the Customer page notes above).
`src/components/PhoneLink.jsx` renders a stored phone as a formatted `tel:` link
(tap-to-call) - used in the Customer table + view modal.

### Getting a caller's number into "Add Customer" (mobile)
A browser can't read the phone's call screen, so the number has to arrive via
clipboard, a share, or a URL:
- **Clipboard** - `PkPhoneInput.jsx` has a paste button + an auto-hint chip
  (reads `navigator.clipboard`, normalises via `toLocal`).
- **PWA share target** - `public/manifest.webmanifest` (`share_target` GET ->
  `/customers`, params `shared_text/shared_title/shared_url`) + `public/sw.js`
  (minimal, registered in `main.jsx`). Install the app on Android, then Share a
  number from the call log -> the CRM opens Add Customer pre-filled.
- **Deep link** - `Customers.jsx` also honours `/customers?phone=03001234567`
  (for a phone automation like Tasker / iOS Shortcuts). It opens Add Customer with
  the phone seeded (`CustomerModal` `initialPhone`), then wipes the query params.
  iOS Safari does NOT support `share_target`; Shortcuts + the deep link is the iOS path.

## Still to confirm
- Customer fields (membership, preferred services)? Base fields for now.
