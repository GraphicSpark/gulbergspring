-- =============================================================================
-- GraphicSpark CRM - internal "accounts" (business units)
--   (applied 2026-08-29; migration crm_accounts)
--
--   Every order is attributed to one account (orders.account_id, required in the
--   UI). Accounts are later rolled into a financial ledger.
--   accounts.manager_id = the internal user (profile) who owns the account.
--   New `accounts` page permission (view/add/edit/delete); nav sits in the
--   sidebar "Account" section. Admins manage; agent/ops get view so they can
--   pick one when creating an order.
-- =============================================================================

create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null default nextval('public.ref_no_seq'),
  name        text not null,
  manager_id  uuid not null references public.profiles(id) on delete restrict,
  location    text not null,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists accounts_manager_idx on public.accounts (manager_id);

drop trigger if exists trg_accounts_updated on public.accounts;
create trigger trg_accounts_updated before update on public.accounts
  for each row execute function public.set_updated_at();

alter table public.orders
  add column if not exists account_id uuid references public.accounts(id) on delete restrict;
create index if not exists orders_account_idx on public.orders (account_id);

alter table public.accounts enable row level security;
create policy acc_select on public.accounts for select to authenticated
  using (private.is_active_user() and private.has_perm('accounts', 'view'));
create policy acc_insert on public.accounts for insert to authenticated
  with check (private.is_admin() or private.has_perm('accounts', 'add'));
create policy acc_update on public.accounts for update to authenticated
  using (private.is_admin() or private.has_perm('accounts', 'edit'))
  with check (private.is_admin() or private.has_perm('accounts', 'edit'));
create policy acc_delete on public.accounts for delete to authenticated
  using (private.is_admin() or private.has_perm('accounts', 'delete'));

grant select, insert, update, delete on public.accounts to authenticated, service_role;

insert into public.role_permissions (role, page, action, allowed) values
  ('admin','accounts','view',true),('admin','accounts','add',true),('admin','accounts','edit',true),('admin','accounts','delete',true),
  ('agent','accounts','view',true),('agent','accounts','add',false),('agent','accounts','edit',false),('agent','accounts','delete',false),
  ('ops','accounts','view',true),('ops','accounts','add',false),('ops','accounts','edit',false),('ops','accounts','delete',false)
on conflict (role, page, action) do nothing;
