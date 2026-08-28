-- =============================================================================
-- GraphicSpark CRM - numeric display ID for packages
--   (applied 2026-08-28; migration crm_client_packages_ref_no)
--
--   Matches customers / clients / orders: own identity sequence starting 10001.
--   The UI shows every ref_no WITHOUT a leading '#'.
-- =============================================================================

alter table public.client_packages
  add column if not exists ref_no bigint generated always as identity (start with 10001);
