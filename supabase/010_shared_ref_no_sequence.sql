-- =============================================================================
-- GraphicSpark CRM - ONE shared display-ID series  (applied 2026-08-28;
--   migrations crm_shared_ref_no_sequence, crm_ref_no_start_1001)
--
--   Before: customers / clients / orders / client_packages each had their own
--   identity sequence -> the same number reused per type.
--   After:  a single sequence `public.ref_no_seq` feeds all four. Whatever record
--   is created next gets the next number, regardless of type
--   (e.g. order 1004 -> package 1005 -> client 1006). Series starts at 1001.
--
--   ref_no stays display-only (no FK anywhere uses it) and is shown as a plain
--   number, no leading '#'. Existing rows were renumbered in creation order.
-- =============================================================================

create sequence if not exists public.ref_no_seq as bigint start with 1001 minvalue 1;

alter table public.customers       alter column ref_no drop identity if exists;
alter table public.clients         alter column ref_no drop identity if exists;
alter table public.orders          alter column ref_no drop identity if exists;
alter table public.client_packages alter column ref_no drop identity if exists;

alter table public.customers       alter column ref_no set default nextval('public.ref_no_seq');
alter table public.clients         alter column ref_no set default nextval('public.ref_no_seq');
alter table public.orders          alter column ref_no set default nextval('public.ref_no_seq');
alter table public.client_packages alter column ref_no set default nextval('public.ref_no_seq');

-- renumber existing rows in true creation order, starting at 1001
do $$
declare r record; n bigint := 1000;
begin
  for r in (
    select tbl, id from (
      select 'customers'       as tbl, id, created_at from public.customers
      union all select 'clients',         id, created_at from public.clients
      union all select 'orders',          id, created_at from public.orders
      union all select 'client_packages', id, created_at from public.client_packages
    ) x
    order by created_at, tbl, id
  ) loop
    n := n + 1;
    execute format('update public.%I set ref_no = $1 where id = $2', r.tbl) using n, r.id;
  end loop;
end $$;

alter table public.customers       alter column ref_no set not null;
alter table public.clients         alter column ref_no set not null;
alter table public.orders          alter column ref_no set not null;
alter table public.client_packages alter column ref_no set not null;

grant usage, select on sequence public.ref_no_seq to authenticated, service_role;

-- keep the sequence above every existing ref_no
select setval('public.ref_no_seq', greatest(
  (select coalesce(max(ref_no), 1000) from public.customers),
  (select coalesce(max(ref_no), 1000) from public.clients),
  (select coalesce(max(ref_no), 1000) from public.orders),
  (select coalesce(max(ref_no), 1000) from public.client_packages)
), true);
