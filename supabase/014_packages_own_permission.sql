-- =============================================================================
-- GraphicSpark CRM - Packages page gets its own permission key
--   (applied 2026-08-29; migration crm_packages_own_permission)
--
--   Before: the Packages page + client_packages / client_package_log RLS rode
--   on the `clients` permission. Now `packages` (view/add/edit/delete) is its
--   own Role Access row, so every navigable page is controllable in the matrix.
--
--   RULE: every navigable page (except Profile) has a row in PERMISSION_PAGES
--   and a seeded `role_permissions` block. New page => add both in one change.
-- =============================================================================

insert into public.role_permissions (role, page, action, allowed) values
  ('admin','packages','view',true),('admin','packages','add',true),('admin','packages','edit',true),('admin','packages','delete',true),
  ('agent','packages','view',true),('agent','packages','add',false),('agent','packages','edit',false),('agent','packages','delete',false),
  ('ops','packages','view',true),('ops','packages','add',false),('ops','packages','edit',false),('ops','packages','delete',false)
on conflict (role, page, action) do nothing;

drop policy if exists cp_select on public.client_packages;
drop policy if exists cp_insert on public.client_packages;
drop policy if exists cp_update on public.client_packages;
drop policy if exists cp_delete on public.client_packages;
drop policy if exists cpl_select on public.client_package_log;

create policy cp_select on public.client_packages for select to authenticated
  using (private.is_active_user() and private.has_perm('packages', 'view'));
create policy cp_insert on public.client_packages for insert to authenticated
  with check (private.is_admin() or private.has_perm('packages', 'edit'));
create policy cp_update on public.client_packages for update to authenticated
  using (private.is_admin() or private.has_perm('packages', 'edit'))
  with check (private.is_admin() or private.has_perm('packages', 'edit'));
create policy cp_delete on public.client_packages for delete to authenticated
  using (private.is_admin() or private.has_perm('packages', 'delete'));

create policy cpl_select on public.client_package_log for select to authenticated
  using (private.is_active_user() and private.has_perm('packages', 'view'));
