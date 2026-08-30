-- =============================================================================
-- GraphicSpark CRM - `reports` permission page
--   (migration crm_reports_permission)
--
-- The new Reports page (`src/pages/Reports.jsx`, left panel + a catalog of
-- cross-project reports) gets its own `reports` (view) permission so it can be
-- granted independently in Role Access. The reports read the existing tables
-- (orders / payouts / customers / clients / profiles) so a reports-only role also
-- needs those tables' own `*.view` perms; RLS is unchanged. Super Admin bypasses.
-- =============================================================================

insert into public.role_permissions (role, page, action, allowed) values
  ('admin', 'reports', 'view', true),
  ('agent', 'reports', 'view', false),
  ('ops',   'reports', 'view', false)
on conflict (role, page, action) do nothing;
