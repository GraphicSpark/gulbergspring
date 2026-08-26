# GraphicSpark CRM

Internal CRM portal for GraphicSpark. Auth-gated React SPA on Supabase.

- **Stack:** React 19 + Vite (JS/JSX), React Router, Supabase (Auth + Postgres + RLS)
- **Deploy:** Vercel (SPA rewrite in `vercel.json`)
- Standalone project — separate git repo, Supabase project, and Vercel project from any other app.

## Getting started

```bash
npm install
cp .env.example .env   # fill in the two VITE_SUPABASE_* values
npm run dev
```

| Script | Purpose |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | oxlint |

## Environment

`.env` (gitignored) holds only **public** values:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

The `service_role` key must never live in this repo, never in a `VITE_` var, and
never be committed. It is server-only (Supabase Edge Function secrets).

## Structure

```
src/
  lib/         supabase client, permission constants
  context/     auth-context, AuthProvider, useAuth
  components/  Layout, Sidebar, Topbar, ProtectedRoute, FullLoader
  pages/       Login, Dashboard, (Clients / Users / Customers / Profile / RoleAccess)
supabase/      001_init.sql + setup notes
```

## Auth & roles

- No public sign-up. Internal users are created by an admin.
- Roles: `super_admin`, `admin`, `agent`, `ops`.
- The UI reads permissions from the `role_permissions` table via `useAuth().can(key)`.
  `super_admin` bypasses every check.

See [`supabase/README.md`](supabase/README.md) for database setup and the first
super-admin bootstrap.
