-- =============================================================================
-- GraphicSpark CRM - `finance` page permission
--   (applied 2026-08-30; migration crm_finance_permission)
--
--   Gates the Finance section (Financial Ledger + Account Ledger). Read-only,
--   admin-only by default. Both pages read the existing `orders` table
--   (confirmed orders only) - no new tables or RLS.
-- =============================================================================

insert into public.role_permissions (role, page, action, allowed) values
  ('admin','finance','view',true),
  ('agent','finance','view',false),
  ('ops','finance','view',false)
on conflict (role, page, action) do nothing;
