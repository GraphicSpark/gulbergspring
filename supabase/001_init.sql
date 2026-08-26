-- =============================================================================
-- GraphicSpark CRM - initial database schema
-- Project ref: fmfbjpblhqgrwqeswztw
--
-- STATUS: already applied to the Supabase project fmfbjpblhqgrwqeswztw (2026-08-26)
-- NOTE: `role_permissions` was later reshaped - see 002_permissions_v2.sql.
-- via MCP migrations: crm_init_schema, crm_harden_functions,
-- crm_move_helpers_to_private_schema. This file is the consolidated source of
-- truth and is idempotent (safe to re-run).
-- =============================================================================

-- ------------------------------------------------------------------ enums ----
do $$ begin
  create type public.user_role as enum ('super_admin', 'admin', 'agent', 'ops');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------- profiles ----
-- One row per internal (staff) user, 1:1 with auth.users.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null default '',
  email       text        not null,
  phone       text,
  role        public.user_role not null default 'agent',
  avatar_url  text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- clients ----
-- Companies (B2B).
create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  company_name   text        not null,
  contact_person text,
  email          text,
  phone          text,
  address        text,
  city           text,
  status         text        not null default 'active',   -- active | inactive | lead
  notes          text,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- -------------------------------------------------------------- customers ----
-- Walk-in customers (B2C).
create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  full_name   text        not null,
  phone       text,
  email       text,
  gender      text,                                        -- male | female | other
  dob         date,
  address     text,
  source      text,                                        -- walk-in | referral | social | other
  notes       text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------- role_permissions ----
-- Permission matrix edited on the "Role Access" page (super_admin only).
create table if not exists public.role_permissions (
  role           public.user_role not null,
  permission_key text             not null,
  allowed        boolean          not null default false,
  primary key (role, permission_key)
);

-- =============================================================================
-- Trigger functions (public schema, but NOT exposed as REST RPC)
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not private.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Not allowed to change role or is_active';
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.set_updated_at()                    from anon, authenticated, public;
revoke execute on function public.handle_new_user()                   from anon, authenticated, public;
revoke execute on function public.protect_profile_privileged_fields() from anon, authenticated, public;

-- ------------------------------------------------------------- triggers ----
drop trigger if exists trg_profiles_updated  on public.profiles;
drop trigger if exists trg_clients_updated   on public.clients;
drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_profiles_updated  before update on public.profiles  for each row execute function public.set_updated_at();
create trigger trg_clients_updated   before update on public.clients   for each row execute function public.set_updated_at();
create trigger trg_customers_updated before update on public.customers for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_profiles_protect on public.profiles;
create trigger trg_profiles_protect before update on public.profiles
  for each row execute function public.protect_profile_privileged_fields();

-- =============================================================================
-- RLS helper functions in `private` schema (PostgREST does not expose it, so
-- these are never reachable as /rest/v1/rpc endpoints). SECURITY DEFINER breaks
-- the RLS recursion on profiles.
-- =============================================================================
create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.current_user_role()
returns public.user_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function private.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false);
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','admin') from public.profiles where id = auth.uid()), false);
$$;

create or replace function private.has_perm(perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select private.current_user_role() = 'super_admin'
      or exists (
        select 1 from public.role_permissions rp
        where rp.role = private.current_user_role()
          and rp.permission_key = perm
          and rp.allowed
      );
$$;

revoke execute on function private.current_user_role() from public, anon;
revoke execute on function private.is_active_user()    from public, anon;
revoke execute on function private.is_admin()          from public, anon;
revoke execute on function private.has_perm(text)      from public, anon;
grant  execute on function private.current_user_role() to authenticated;
grant  execute on function private.is_active_user()    to authenticated;
grant  execute on function private.is_admin()          to authenticated;
grant  execute on function private.has_perm(text)      to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles         enable row level security;
alter table public.clients          enable row level security;
alter table public.customers        enable row level security;
alter table public.role_permissions enable row level security;

-- ---- profiles ----
drop policy if exists profiles_select     on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_admin_all  on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (private.is_active_user());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- ---- clients ----
drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
drop policy if exists clients_delete on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (private.is_active_user() and private.has_perm('clients.view'));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.is_admin() or private.has_perm('clients.create'));
create policy clients_update on public.clients for update to authenticated
  using (private.is_admin() or private.has_perm('clients.edit'))
  with check (private.is_admin() or private.has_perm('clients.edit'));
create policy clients_delete on public.clients for delete to authenticated
  using (private.is_admin() or private.has_perm('clients.delete'));

-- ---- customers ----
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;
create policy customers_select on public.customers for select to authenticated
  using (private.is_active_user() and private.has_perm('customers.view'));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.is_admin() or private.has_perm('customers.create'));
create policy customers_update on public.customers for update to authenticated
  using (private.is_admin() or private.has_perm('customers.edit'))
  with check (private.is_admin() or private.has_perm('customers.edit'));
create policy customers_delete on public.customers for delete to authenticated
  using (private.is_admin() or private.has_perm('customers.delete'));

-- ---- role_permissions ----
drop policy if exists rp_select      on public.role_permissions;
drop policy if exists rp_super_admin on public.role_permissions;
create policy rp_select on public.role_permissions for select to authenticated
  using (private.is_active_user());
create policy rp_super_admin on public.role_permissions for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- =============================================================================
-- Seed: permission matrix (super_admin is NOT seeded - it bypasses all checks)
-- =============================================================================
insert into public.role_permissions (role, permission_key, allowed) values
  ('admin','clients.view',true),('admin','clients.create',true),('admin','clients.edit',true),('admin','clients.delete',true),
  ('admin','customers.view',true),('admin','customers.create',true),('admin','customers.edit',true),('admin','customers.delete',true),
  ('admin','users.view',true),('admin','users.create',true),('admin','users.edit',true),('admin','users.deactivate',true),
  ('admin','roles.manage',false),
  ('agent','clients.view',true),('agent','clients.create',true),('agent','clients.edit',true),('agent','clients.delete',false),
  ('agent','customers.view',true),('agent','customers.create',true),('agent','customers.edit',true),('agent','customers.delete',false),
  ('agent','users.view',true),('agent','users.create',false),('agent','users.edit',false),('agent','users.deactivate',false),
  ('agent','roles.manage',false),
  ('ops','clients.view',true),('ops','clients.create',false),('ops','clients.edit',false),('ops','clients.delete',false),
  ('ops','customers.view',true),('ops','customers.create',true),('ops','customers.edit',true),('ops','customers.delete',false),
  ('ops','users.view',true),('ops','users.create',false),('ops','users.edit',false),('ops','users.deactivate',false),
  ('ops','roles.manage',false)
on conflict (role, permission_key) do nothing;
