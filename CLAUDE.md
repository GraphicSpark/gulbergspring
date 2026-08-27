# GraphicSpark CRM - Project Context

## Overview
A **spa referral business** CRM. GraphicSpark sends walk-in **customers** to
**client** spas (companies with branches) and keeps a margin per **order**:
  every order picks one of the client's **packages** (each has a price) -> order amount
  auto-fills from that price, minus an optional per-order discount -> customer pays `amount` ->
  client is paid that package's rate (a fixed Rs or a % of amount) ->
  GraphicSpark gross = amount - client cut -> the order's **agent** (its creator)
  gets a fixed Rs or a % of that gross -> GraphicSpark net = gross - agent cut.
The order snapshots the package rate at creation; the split is frozen when the
order is **confirmed** (`orders.confirm` permission).

GraphicSpark's internal CRM portal. Standalone project, **completely separate** from
BlackDrivo (D:\BlackDrivoAdmin): its own git repo, GitHub remote, Supabase project,
and Vercel project. Do not share keys, tables, or deploy targets with BlackDrivo.
BlackDrivo's Admin UI rules (region-wise pattern, no-icons, etc.) do NOT apply here.

- Folder: `E:\GraphicSparkCRM`  (still `E:\GulbergSPA` until the user renames it)
- GitHub: https://github.com/GraphicSpark/gulbergspring  (remote `origin`; repo kept the old name)
- Supabase: https://fmfbjpblhqgrwqeswztw.supabase.co  (project ref `fmfbjpblhqgrwqeswztw`)

## Stack
- React 19 + Vite (JavaScript / JSX)
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

- **Left sidebar: LIGHT, not dark.** White background, `border-right`, a `#E6E6E6`
  brand strip at the top holding `GSlogo.png`. Nav is split into labelled sections
  ("Records", "Administration", "Account") with 10px uppercase section labels and a
  `border-top` between sections.
  Active / hover nav item = **accent text + a 3px accent bar on the left edge**.
  NO filled "pill" background on the active item. lucide icons at `size={17}`.
  Component: `src/components/Sidebar.jsx` + `src/components/layout.css`.
- **Date / range filters** (dashboard, list pages): flat **underline tabs** -
  "All Time / Today / This Week / This Month" - active tab has a 2px accent
  bottom-border and accent text. **Do NOT use pill-shaped filter chips.**
  Component: `src/components/RangeTabs.jsx`; option sets in `src/lib/filters.js`.
- The full-pill radius stays for real CTA buttons only (`.btn`).

## CRM Portal Structure
Auth-gated. Supabase Auth login screen -> portal. No public sign-up - internal
users are created by an admin only.

No topbar bar - just a floating **profile chip** at top-right: avatar +
name + role (role hidden on mobile), chevron, and a dropdown (Profile link,
Logout). On mobile a hamburger (top-left) opens the sidebar drawer.
Component: `src/components/Topbar.jsx`.

Left sidebar menu (grouped into sections - see UI conventions below):
- (top)            Dashboard      - "Coming soon" placeholder for now, built later
- Records:         Clients        - spa companies + their branches
- Records:         Packages       - per-client service "menu"; each package has its own
                    rate (fixed Rs / % of order). Rate changes are logged. Nav-gated on
                    `clients.view`, edits on `clients.edit`.
- Records:         Customer       - walk-in customers
- Records:         Orders         - customer -> client referral; every order picks a package
- Administration:  User Management - internal staff list; Super Admin / Admin can
                    CREATE users, everyone else is read-only (view the user table)
- Administration:  Role Access    - permission matrix per role (managed by Super Admin)
- Account:         Profile        - separate page; the logged-in user edits their own info

Each item is permission-gated: hidden unless the user has the matching `*.view`
permission (Role Access is super_admin only; Dashboard/Profile always shown).

## Roles
`super_admin`, `admin`, `agent`, `ops` (fixed - `user_role` is a Postgres enum,
no custom roles without an `ALTER TYPE`).
- Super Admin: everything, bypasses every permission check
- Admin: `is_admin()` in RLS; broad defaults incl. user management
- Agent / Ops: whatever the Role Access matrix grants
The UI reads permissions (never hard-codes role checks) except the super_admin bypass.

## Permission model - page x action, role-wise + user-wise (migration 2026-08-27)
- **Pages**: `dashboard` (view), `clients`, `customers`, `orders`, `users`
  (view/add/edit/delete), `roles` (view/edit). `orders` also has `confirm`.
  Catalogue: `src/lib/permissions.js` (`PERMISSION_PAGES`).
  On the `users` page, `delete` = "deactivate". `perm_action` enum now includes `confirm`.
- `role_permissions (role, page, action, allowed)` - per-role defaults
- `user_permissions (user_id, page, action, allowed)` - per-user override (wins over role)
- `private.has_perm(page text, action perm_action)`: super_admin -> true;
  else user override, else role default, else false
- `AuthContext.can(page, action)` is the single client gate; RLS on
  clients/customers/orders/client_branches/client_packages calls `has_perm`.
  Packages + the package log are gated on the `clients` page permission.
- Role Access page: **By Role** and **By User** modes; both edit the matrix.
  Writes are super_admin-only (RLS `rp_super_admin` / `up_super_admin`).

## Edge Function `admin-users` - DEPLOYED to fmfbjpblhqgrwqeswztw (v5, 2026-08-28)
`supabase/functions/admin-users/index.ts`. The ONLY place the service_role key
is used (Supabase injects it - no secret to configure). verify_jwt on.
Every profile mutation for OTHER users goes through it. Actions:
- `create`      { full_name, email, phone, role, password }                - needs `users.add`
- `update`      { user_id, full_name?, phone?, role?, commission_kind?, commission_value?, commission_active? } - `users.edit`
- `set_password`{ user_id, password }                                      - needs `users.edit`
- `set_active`  { user_ids[], active }                                     - `users.edit` on / `users.delete` off
Non-super callers cannot touch `super_admin`/`admin` accounts. Client wrapper:
`src/lib/adminUsers.js`. The user logs in with the password set at create time.

## Data model - Supabase (see /supabase/*.sql)
- **Gotcha fixed 2026-08-27** (`003_grants.sql`): tables made via MCP migrations
  get NO `anon/authenticated/service_role` grants (Supabase auto-grant only fires
  for role `postgres`), so every REST call 403'd. Any NEW table needs
  `grant select,insert,update,delete on <t> to authenticated, service_role;`
  (default privileges are now set, but only for the migration-runner role).

- `profiles`         - 1:1 with auth.users; full_name, email, phone, role, avatar_url, is_active
- `clients`          - the company: company_name, status (active|lead|inactive), notes, created_by
- `client_branches`  - (client_id, branch_name, city, poc_name, poc_phone, poc_email, address,
                        is_primary)  [new 2026-08-27, `004_client_branches.sql`; clients lost
                        contact_person/email/phone/address/city]. One primary branch per client
                        (partial unique index). RLS follows the `clients` page permission.
- `customers`        - ref_no (#10001+), full_name, phone, email, gender, dob, address, source, notes
- `orders`           - ref_no (#10001+), customer_id, client_id, branch_id, agent_id,
                        package_id + package_name (snapshot), service (legacy, auto-filled
                        from the package name), list_amount (snapshot of the package price),
                        discount_kind ('none'|'fixed'|'percent') + discount_value,
                        amount (DERIVED by the snapshot trigger = list_amount - discount),
                        status (pending|confirmed|cancelled), + frozen split
                        (client_amount / agent_amount / company_amount) set by `confirm_order()`.
                        [005_orders.sql, 006_client_packages.sql, 007_package_price_discount.sql]
- `client_packages`  - (client_id, name, price, commission_kind 'fixed'|'percent',
                        commission_value, is_active). Per-client package menu; `price` is the
                        sticker price that auto-fills the order amount. `commission_*` = what
                        GraphicSpark pays the client for that package (a % is charged on the
                        DISCOUNTED amount; fixed is unaffected by discount). Partial unique
                        index on (client_id, lower(name)) where is_active.
                        [006_client_packages.sql, 007_package_price_discount.sql]
- `client_package_log` - append-only; one row per rate change, written by the SECURITY DEFINER
                        trigger `log_client_package_change()` (old/new kind+value + auth.uid()).
- **Order <-> package snapshot**: `trg_orders_snapshot` (BEFORE INSERT/UPDATE) copies the
  package's name + rate + price onto the order on insert or package-change *while
  status='pending'*, derives `amount` = `list_amount - discount` (floored at 0), and copies
  the agent's commission. So editing/deactivating a package NEVER affects existing orders,
  and `amount` is always server-derived (the client never sends it). `confirm_order()` uses
  the order's frozen `client_kind/value` (falls back to live client config only for legacy
  orders with no snapshot).
- **Where each cut is configured**: client cut -> the **package** (Packages page); agent cut
  -> the **agent's profile** (User Management -> Edit user), with an on/off switch
  (`commission_active`); GraphicSpark -> automatic remainder, never set by hand.
- `profiles` carries `commission_kind` ('fixed'|'percent') + `commission_value` = the agent's
  cut of the GS gross, plus `commission_active` (bool, default true) = an on/off switch: when
  false, `confirm_order()` gives the agent 0 and GraphicSpark keeps the whole cut. The switch
  is read LIVE at confirm (affects pending orders; confirmed ones stay frozen).
  [008_agent_commission_toggle.sql]. Non-admins can't change their own commission
  (trg_profiles_protect - role/is_active/commission_kind/value/active).
  `clients.commission_kind/value` columns still exist but are UNUSED by the UI (superseded by
  packages); kept only as the `confirm_order` legacy fallback.
- `role_permissions` - (role, page, action, allowed)  [restructured 2026-08-27]
- `user_permissions` - (user_id, page, action, allowed)  [new 2026-08-27]
- `confirm_order(uuid)` - SECURITY DEFINER RPC, gated by `orders.confirm`, computes + freezes
  the commission split. (Supabase advisor flags it as user-executable - intentional.)
- RLS on all 10 tables. `private` helper fns (not REST-exposed):
  `is_admin()`, `current_user_role()`, `is_active_user()`, `has_perm(text, perm_action)`
- Trigger `on_auth_user_created` auto-inserts a `profiles` row for every new auth user
- Trigger `trg_profiles_protect` blocks role/is_active changes by a logged-in
  non-admin; a service-role connection (auth.uid() null) is allowed through
- Supabase security advisors: clean (one unrelated Auth WARN: leaked-password
  protection is off - optional dashboard toggle)
- MCP access: this Claude connector CAN reach project `fmfbjpblhqgrwqeswztw` via
  `apply_migration` / `execute_sql` (execute_sql runs as read-only user)

## First super_admin - DONE
- `gulbergspring@gmail.com` / name "Maqbool" / role `super_admin` (created 2026-08-26).
- Note: the `trg_profiles_protect` trigger blocks role changes outside an admin
  session, so seeding roles via SQL needs
  `alter table public.profiles disable trigger trg_profiles_protect;` ... `enable` around it.

## Rename (Gulberg SPA -> GraphicSpark CRM) - 2026-08-26
- [x] App code + docs renamed to "GraphicSpark CRM" (brand shows as "GraphicSpark")
- [ ] Folder: user renames `E:\GulbergSPA` -> `E:\GraphicSparkCRM`, then reopens Claude Code there
- [~] GitHub: repo kept as `gulbergspring` (remote points there; code pushed 2026-08-27)
- [ ] Supabase: user renames project display name in Dashboard (ref `fmfbjpblhqgrwqeswztw` is unchanged)
- Note: first super_admin login stays `gulbergspring@gmail.com` (existing auth account, not affected by rename)

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
      Fields: Name*, Contact no* (PK phone), Source*, Notes?. (email/gender/address DB columns
      exist but are unused in the UI.)
- [x] Reusable table kit: `src/components/data/` (DataTable, FilterBar, Pagination, BulkBar, StatCards)
- [x] Clients page (`src/pages/Clients.jsx`) - company list; View modal shows the company
      + its branches (add/edit/delete branch inline, one primary). Add Client creates the
      company + its primary branch in one form. Shows a Packages count column. CSV import
      (row=branch, grouped by company) / export (flattened). No commission fields (-> Packages).
- [x] Packages page (`src/pages/Packages.jsx`) - pick a client -> its package list; add
      unlimited packages, each with a **price** + its own fixed Rs / % client rate + active
      toggle. History modal per package (from `client_package_log`). Gated on `clients` perm.
- [x] Orders page (`src/pages/Orders.jsx`) - Add order (Client -> Branch -> **Package** ->
      Customer; creator = agent). Amount auto-fills from the package price; a per-order
      **discount** (none / fixed Rs / %) gives the final "customer pays" amount (amount is
      never typed by hand). A client with no active package can't get orders. View modal:
      Confirm (orders.confirm) -> `confirm_order` RPC freezes the split and shows it; Edit /
      Cancel while pending. `<SearchSelect>` combobox. 8 routes, all real.
- [x] Agent commission: User (agent) edit form - an on/off checkbox ("This agent earns
      commission on their orders") + type/value; goes through the `admin-users` EF `update`
      action (v5, adds `commission_active`). Client-level commission removed - each package
      carries its own rate.

## Phone numbers - Pakistani mobile only
`src/lib/phone.js` + `src/components/PkPhoneInput.jsx`. UI shows a fixed `+92`
prefix; the user types the 10-digit local part which must match `/^3\d{9}$/`
(starts with 3, exactly 10 digits). Stored as `+923XXXXXXXXX`, displayed as
`+92 3XX XXXXXXX`. CSV import validates phones the same way and skips bad rows.

## Still to confirm
- Customer fields (membership, preferred services)? Base fields for now.
