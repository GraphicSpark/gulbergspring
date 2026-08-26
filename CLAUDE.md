# GraphicSpark CRM - Project Context

## Overview
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

Topbar:
- Profile icon (right) with dropdown: Profile page link, Logout.

Left sidebar menu (grouped into sections - see UI conventions below):
- (top)            Dashboard      - "Coming soon" placeholder for now, built later
- Records:         Clients        - companies (B2B)
- Records:         Customer       - walk-in customers (B2C)
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
- **Pages**: `dashboard` (view), `clients`, `customers`, `users` (view/add/edit/delete),
  `roles` (view/edit). Catalogue: `src/lib/permissions.js` (`PERMISSION_PAGES`).
  On the `users` page, `delete` = "deactivate".
- `role_permissions (role, page, action, allowed)` - per-role defaults
- `user_permissions (user_id, page, action, allowed)` - per-user override (wins over role)
- `private.has_perm(page text, action perm_action)`: super_admin -> true;
  else user override, else role default, else false
- `AuthContext.can(page, action)` is the single client gate; RLS on
  clients/customers calls `has_perm`
- Role Access page: **By Role** and **By User** modes; both edit the matrix.
  Writes are super_admin-only (RLS `rp_super_admin` / `up_super_admin`).

## Edge Function `admin-users` - DEPLOYED to fmfbjpblhqgrwqeswztw (v3, 2026-08-27)
`supabase/functions/admin-users/index.ts`. The ONLY place the service_role key
is used (Supabase injects it - no secret to configure). verify_jwt on.
Every profile mutation for OTHER users goes through it. Actions:
- `create`      { full_name, email, phone, role, password }  - needs `users.add`
- `update`      { user_id, full_name?, phone?, role? }        - needs `users.edit`
- `set_password`{ user_id, password }                         - needs `users.edit`
- `set_active`  { user_ids[], active }                        - `users.edit` on / `users.delete` off
Non-super callers cannot touch `super_admin`/`admin` accounts. Client wrapper:
`src/lib/adminUsers.js`. The user logs in with the password set at create time.

## Data model - Supabase (see /supabase/*.sql)
- **Gotcha fixed 2026-08-27** (`003_grants.sql`): tables made via MCP migrations
  get NO `anon/authenticated/service_role` grants (Supabase auto-grant only fires
  for role `postgres`), so every REST call 403'd. Any NEW table needs
  `grant select,insert,update,delete on <t> to authenticated, service_role;`
  (default privileges are now set, but only for the migration-runner role).

- `profiles`         - 1:1 with auth.users; full_name, email, phone, role, avatar_url, is_active
- `clients`          - company_name, contact_person, email, phone, address, city, status, notes, created_by
- `customers`        - full_name, phone, email, gender, dob, address, source, notes, created_by
- `role_permissions` - (role, page, action, allowed)  [restructured 2026-08-27]
- `user_permissions` - (user_id, page, action, allowed)  [new 2026-08-27]
- RLS on all 5 tables. `private` helper fns (not REST-exposed):
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
      (`src/components/ConfirmDelete.jsx`), advanced filters, CSV import (+ sample) / export.
      Required: Name, Phone, Source. Fields: name, phone, source, email?, gender?, location area?, notes?
- [x] Reusable table kit: `src/components/data/` (DataTable, FilterBar, Pagination, BulkBar, StatCards)
- [~] Pages still stubbed: Clients (use the same `data/` kit + `<Modal>` when built)

## Phone numbers - Pakistani mobile only
`src/lib/phone.js` + `src/components/PkPhoneInput.jsx`. UI shows a fixed `+92`
prefix; the user types the 10-digit local part which must match `/^3\d{9}$/`
(starts with 3, exactly 10 digits). Stored as `+923XXXXXXXXX`, displayed as
`+92 3XX XXXXXXX`. CSV import validates phones the same way and skips bad rows.

## Still to confirm
- Customer fields (membership, preferred services)? Base fields for now.
