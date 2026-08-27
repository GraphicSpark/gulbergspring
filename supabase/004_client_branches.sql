-- =============================================================================
-- GraphicSpark CRM - B2B clients + branches  (applied 2026-08-27, clients empty)
--   Migration: crm_client_branches
--
--   clients          = the company (company_name, status, notes)
--   client_branches  = each office/branch (branch_name, city, POC, is_primary)
--
-- Supersedes the flat `clients` columns from 001_init.sql (contact_person,
-- email, phone, address, city were dropped and moved to client_branches).
-- =============================================================================

alter table public.clients
  drop column if exists contact_person,
  drop column if exists email,
  drop column if exists phone,
  drop column if exists address,
  drop column if exists city;

create table if not exists public.client_branches (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  branch_name text not null default 'Main',
  city        text,
  poc_name    text,
  poc_phone   text,
  poc_email   text,
  address     text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists client_branches_client_idx on public.client_branches (client_id);
create unique index if not exists client_branches_one_primary
  on public.client_branches (client_id) where is_primary;

drop trigger if exists trg_client_branches_updated on public.client_branches;
create trigger trg_client_branches_updated before update on public.client_branches
  for each row execute function public.set_updated_at();

alter table public.client_branches enable row level security;

-- a branch follows the `clients` page permissions
create policy cb_select on public.client_branches for select to authenticated
  using (private.is_active_user() and private.has_perm('clients', 'view'));
create policy cb_insert on public.client_branches for insert to authenticated
  with check (private.is_admin() or private.has_perm('clients', 'add'));
create policy cb_update on public.client_branches for update to authenticated
  using (private.is_admin() or private.has_perm('clients', 'edit'))
  with check (private.is_admin() or private.has_perm('clients', 'edit'));
create policy cb_delete on public.client_branches for delete to authenticated
  using (private.is_admin() or private.has_perm('clients', 'delete'));

grant select, insert, update, delete on public.client_branches to authenticated, service_role;
