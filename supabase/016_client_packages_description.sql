-- =============================================================================
-- GraphicSpark CRM - optional free-text description for a package
--   (applied 2026-08-30; migration crm_client_packages_description)
--
--   Plain text; the form (`src/components/BulletTextarea.jsx`) offers a "Bullet"
--   button that inserts "• " lines. Shown as a preview under the package name
--   in the Packages table (full text on hover).
-- =============================================================================

alter table public.client_packages
  add column if not exists description text;
