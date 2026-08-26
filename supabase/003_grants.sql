-- =============================================================================
-- GraphicSpark CRM - table privilege grants  (applied 2026-08-27)
--
-- Migrations:
--   crm_grant_table_privileges_to_authenticated
--   crm_grant_table_privileges_to_service_role
--
-- 001_init.sql created the tables through MCP migrations (not as role `postgres`),
-- so Supabase's default "GRANT ALL to anon/authenticated/service_role" never
-- applied - every REST call for `authenticated` and every Edge Function query
-- for `service_role` returned 403 "permission denied for table". RLS is still
-- the real gatekeeper; these grants just let the row policies run.
-- =============================================================================

grant select, insert, update, delete on public.profiles         to authenticated, service_role;
grant select, insert, update, delete on public.clients          to authenticated, service_role;
grant select, insert, update, delete on public.customers        to authenticated, service_role;
grant select, insert, update, delete on public.role_permissions to authenticated, service_role;
grant select, insert, update, delete on public.user_permissions to authenticated, service_role;

grant select on public.profiles to anon;  -- anon still never passes RLS (all policies are `to authenticated`)

-- future tables in `public` inherit the grants regardless of which role runs the migration
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public
  grant select on tables to anon;
