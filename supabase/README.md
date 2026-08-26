# Supabase setup - GraphicSpark CRM

Project: https://fmfbjpblhqgrwqeswztw.supabase.co (ref `fmfbjpblhqgrwqeswztw`)

## 1. Schema  -  ALREADY APPLIED

- `001_init.sql` (2026-08-26): `profiles`, `clients`, `customers`,
  `role_permissions` + RLS + `private.*` helpers + the new-user trigger.
- Migration `crm_permissions_page_action_model` (2026-08-27): reshaped
  `role_permissions` to `(role, page, action, allowed)`, added
  `user_permissions (user_id, page, action, allowed)`, rewrote
  `private.has_perm(page, action)`, re-pointed the clients/customers RLS.
- Migration `crm_profile_protect_allow_service_role` (2026-08-27): the
  `trg_profiles_protect` trigger now lets a service-role connection through.
- `003_grants.sql` (2026-08-27): table privilege grants for `authenticated` /
  `service_role`. 001_init.sql created the tables via MCP (not as `postgres`) so
  Supabase's default grants never applied and every REST call was 403.

`001_init.sql` is idempotent; the later migrations are one-way (they drop the
old `role_permissions` shape).

## Edge Function

`admin-users` is deployed (see `supabase/functions/admin-users/index.ts` and the
CLAUDE.md section). It is the only code path using the service_role key.

## 2. Auth settings

Dashboard → **Authentication** → **Providers** → Email: keep enabled.
Dashboard → **Authentication** → **Sign In / Providers** → **turn OFF "Allow new users to sign up"**
(internal users are created by an admin only).

## 3. Create the first Super Admin

There is no sign-up UI, so seed the first user by hand:

1. Dashboard → **Authentication** → **Users** → **Add user** → set email + password.
2. The trigger creates a `profiles` row automatically. Now promote it:

```sql
update public.profiles
set role = 'super_admin', full_name = 'Owner Name'
where email = 'you@example.com';
```

That user can then create everyone else from the **User Management** page and
edit the permission matrix on **Role Access**.

## Permissions (page x action)

| Page        | Actions                    |
| ----------- | -------------------------- |
| `dashboard` | `view`                     |
| `clients`   | `view` `add` `edit` `delete` |
| `customers` | `view` `add` `edit` `delete` |
| `users`     | `view` `add` `edit` `delete` (delete = deactivate) |
| `roles`     | `view` `edit`              |

- `role_permissions (role, page, action, allowed)` - defaults per role
- `user_permissions (user_id, page, action, allowed)` - per-person override, wins
- Effective = `super_admin` ? true : (user override ?? role default ?? false)
- Matrix is edited on the Role Access page; only `super_admin` can save.
