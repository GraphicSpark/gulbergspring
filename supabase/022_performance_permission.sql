-- =============================================================================
-- GraphicSpark CRM - `performance` permission page
--   (migration crm_performance_permission)
--
-- The new sidebar "Performance" section (Package Performance + Agent Performance,
-- `src/pages/PackagePerformance.jsx` / `src/pages/AgentPerformance.jsx`) was gated
-- on `finance`; it now has its own `performance` (view) permission so it can be
-- granted independently in Role Access.
--
-- No RLS table of its own - both pages read `orders` (still `has_perm('orders',
-- 'view')`-gated). No seeding is strictly required (an unseeded page defaults to
-- denied for non-super roles), but keep the built-in `admin` role's access.
-- =============================================================================

insert into public.role_permissions (role, page, action, allowed) values
  ('admin', 'performance', 'view', true),
  ('agent', 'performance', 'view', false),
  ('ops',   'performance', 'view', false)
on conflict (role, page, action) do nothing;
