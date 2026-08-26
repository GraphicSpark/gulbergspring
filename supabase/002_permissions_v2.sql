-- =============================================================================
-- GraphicSpark CRM - permission model v2  (applied to fmfbjpblhqgrwqeswztw 2026-08-27)
--
-- Migrations, in order:
--   crm_permissions_page_action_model
--   crm_profile_protect_allow_service_role
--
-- Supersedes the `role_permissions (role, permission_key, allowed)` shape from
-- 001_init.sql. One-way: it drops the old table.
-- =============================================================================

do $$ begin
  create type public.perm_action as enum ('view', 'add', 'edit', 'delete');
exception when duplicate_object then null; end $$;

drop policy if exists clients_select   on public.clients;
drop policy if exists clients_insert   on public.clients;
drop policy if exists clients_update   on public.clients;
drop policy if exists clients_delete   on public.clients;
drop policy if exists customers_select on public.customers;
drop policy if exists customers_insert on public.customers;
drop policy if exists customers_update on public.customers;
drop policy if exists customers_delete on public.customers;

drop function if exists private.has_perm(text);

drop table if exists public.role_permissions cascade;
create table public.role_permissions (
  role    public.user_role   not null,
  page    text               not null,
  action  public.perm_action not null,
  allowed boolean            not null default false,
  primary key (role, page, action)
);

create table if not exists public.user_permissions (
  user_id uuid               not null references public.profiles(id) on delete cascade,
  page    text               not null,
  action  public.perm_action not null,
  allowed boolean            not null,
  primary key (user_id, page, action)
);

-- super_admin -> true; else user override, else role default, else false
create or replace function private.has_perm(p_page text, p_action public.perm_action)
returns boolean language sql stable security definer set search_path = public as $$
  select
    private.current_user_role() = 'super_admin'
    or coalesce(
      (select allowed from public.user_permissions
         where user_id = auth.uid() and page = p_page and action = p_action),
      (select allowed from public.role_permissions
         where role = private.current_user_role() and page = p_page and action = p_action),
      false
    );
$$;
revoke execute on function private.has_perm(text, public.perm_action) from public, anon;
grant  execute on function private.has_perm(text, public.perm_action) to authenticated;

alter table public.role_permissions enable row level security;
alter table public.user_permissions enable row level security;

create policy rp_select on public.role_permissions for select to authenticated
  using (private.is_active_user());
create policy rp_super_admin on public.role_permissions for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

create policy up_select on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or private.current_user_role() = 'super_admin');
create policy up_super_admin on public.user_permissions for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

create policy clients_select on public.clients for select to authenticated
  using (private.is_active_user() and private.has_perm('clients', 'view'));
create policy clients_insert on public.clients for insert to authenticated
  with check (private.is_admin() or private.has_perm('clients', 'add'));
create policy clients_update on public.clients for update to authenticated
  using (private.is_admin() or private.has_perm('clients', 'edit'))
  with check (private.is_admin() or private.has_perm('clients', 'edit'));
create policy clients_delete on public.clients for delete to authenticated
  using (private.is_admin() or private.has_perm('clients', 'delete'));

create policy customers_select on public.customers for select to authenticated
  using (private.is_active_user() and private.has_perm('customers', 'view'));
create policy customers_insert on public.customers for insert to authenticated
  with check (private.is_admin() or private.has_perm('customers', 'add'));
create policy customers_update on public.customers for update to authenticated
  using (private.is_admin() or private.has_perm('customers', 'edit'))
  with check (private.is_admin() or private.has_perm('customers', 'edit'));
create policy customers_delete on public.customers for delete to authenticated
  using (private.is_admin() or private.has_perm('customers', 'delete'));

-- Let a service-role connection (auth.uid() NULL) set role / is_active. A
-- logged-in non-admin still cannot change their own role or is_active.
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not private.is_admin() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'Not allowed to change role or is_active';
    end if;
  end if;
  return new;
end $$;

-- ---- seed role defaults (super_admin bypasses, not stored) ----
insert into public.role_permissions (role, page, action, allowed) values
  ('admin','dashboard','view',true),
  ('admin','clients','view',true),('admin','clients','add',true),('admin','clients','edit',true),('admin','clients','delete',true),
  ('admin','customers','view',true),('admin','customers','add',true),('admin','customers','edit',true),('admin','customers','delete',true),
  ('admin','users','view',true),('admin','users','add',true),('admin','users','edit',true),('admin','users','delete',true),
  ('admin','roles','view',false),('admin','roles','edit',false),
  ('agent','dashboard','view',true),
  ('agent','clients','view',true),('agent','clients','add',true),('agent','clients','edit',true),('agent','clients','delete',false),
  ('agent','customers','view',true),('agent','customers','add',true),('agent','customers','edit',true),('agent','customers','delete',false),
  ('agent','users','view',true),('agent','users','add',false),('agent','users','edit',false),('agent','users','delete',false),
  ('agent','roles','view',false),('agent','roles','edit',false),
  ('ops','dashboard','view',true),
  ('ops','clients','view',true),('ops','clients','add',false),('ops','clients','edit',false),('ops','clients','delete',false),
  ('ops','customers','view',true),('ops','customers','add',true),('ops','customers','edit',true),('ops','customers','delete',false),
  ('ops','users','view',true),('ops','users','add',false),('ops','users','edit',false),('ops','users','delete',false),
  ('ops','roles','view',false),('ops','roles','edit',false)
on conflict (role, page, action) do nothing;
