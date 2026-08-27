-- =============================================================================
-- GraphicSpark CRM - per-client package "menu" + price-change log
--   (applied 2026-08-27; migrations crm_client_packages,
--    crm_lock_down_trigger_functions)
--
--   client_packages    = a named package for one client, with its own rate
--                        (fixed Rs per order OR % of the order amount)
--   client_package_log = append-only audit of every rate change
--
--   Every order MUST pick a package (enforced in the UI - a client with no
--   active package cannot have orders created for it). The order snapshots the
--   package name + rate at creation time via trg_orders_snapshot, so editing or
--   deactivating a package later never changes an existing order. confirm_order()
--   reads the order's frozen snapshot, falling back to live config only if a
--   legacy order has no snapshot.
-- =============================================================================

-- 1) client_packages -----------------------------------------------------------
create table if not exists public.client_packages (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  name             text not null,
  commission_kind  text not null default 'fixed' check (commission_kind in ('fixed','percent')),
  commission_value numeric(12,2) not null default 0,
  is_active        boolean not null default true,
  created_by       uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists client_packages_client_idx on public.client_packages (client_id);
-- one active package name per client (case-insensitive); inactive names may repeat
create unique index if not exists client_packages_name_uniq
  on public.client_packages (client_id, lower(name)) where is_active;

drop trigger if exists trg_client_packages_updated on public.client_packages;
create trigger trg_client_packages_updated before update on public.client_packages
  for each row execute function public.set_updated_at();

-- 2) client_package_log (append-only) -----------------------------------------
create table if not exists public.client_package_log (
  id           uuid primary key default gen_random_uuid(),
  package_id   uuid references public.client_packages(id) on delete cascade,
  client_id    uuid,
  package_name text,
  old_kind     text, old_value numeric(12,2),
  new_kind     text, new_value numeric(12,2),
  changed_by   uuid references public.profiles(id) on delete set null,
  changed_at   timestamptz not null default now()
);
create index if not exists client_package_log_pkg_idx on public.client_package_log (package_id);

create or replace function public.log_client_package_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.commission_kind is distinct from old.commission_kind
  or new.commission_value is distinct from old.commission_value then
    insert into public.client_package_log
      (package_id, client_id, package_name, old_kind, old_value, new_kind, new_value, changed_by)
    values (new.id, new.client_id, new.name,
            old.commission_kind, old.commission_value,
            new.commission_kind, new.commission_value, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists trg_client_package_log on public.client_packages;
create trigger trg_client_package_log after update on public.client_packages
  for each row execute function public.log_client_package_change();

-- 3) orders: reference + snapshot the package ---------------------------------
alter table public.orders
  add column if not exists package_id   uuid references public.client_packages(id) on delete set null,
  add column if not exists package_name text;

create or replace function public.orders_snapshot_package()
returns trigger language plpgsql security definer set search_path = public as $$
declare pk record;
begin
  if new.status = 'pending' then
    if new.package_id is not null and (tg_op = 'INSERT' or new.package_id is distinct from old.package_id) then
      select name, commission_kind, commission_value into pk from public.client_packages where id = new.package_id;
      new.package_name  := pk.name;
      new.client_kind   := pk.commission_kind;
      new.client_value  := pk.commission_value;
      if coalesce(new.service, '') = '' then new.service := pk.name; end if;
    end if;
    if new.agent_id is not null and (tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id) then
      select commission_kind, commission_value into new.agent_kind, new.agent_value
        from public.profiles where id = new.agent_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_snapshot on public.orders;
create trigger trg_orders_snapshot before insert or update on public.orders
  for each row execute function public.orders_snapshot_package();

-- 4) confirm_order: prefer the order's frozen snapshot, fall back to live config
create or replace function public.confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  ck text; cv numeric; ak text; av numeric;
  v_client numeric; v_gross numeric; v_agent numeric;
begin
  if not (private.current_user_role() = 'super_admin'
          or private.is_admin()
          or private.has_perm('orders', 'confirm')) then
    raise exception 'Not allowed to confirm orders';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending' then raise exception 'Order is % - only pending orders can be confirmed', o.status; end if;

  ck := coalesce(o.client_kind,  (select commission_kind  from public.clients where id = o.client_id));
  cv := coalesce(o.client_value, (select commission_value from public.clients where id = o.client_id), 0);
  v_client := case when ck = 'percent' then round(o.amount * cv / 100, 2) else cv end;
  v_gross  := o.amount - v_client;

  v_agent := 0; ak := o.agent_kind; av := o.agent_value;
  if o.agent_id is not null then
    ak := coalesce(o.agent_kind,  (select commission_kind  from public.profiles where id = o.agent_id));
    av := coalesce(o.agent_value, (select commission_value from public.profiles where id = o.agent_id), 0);
    v_agent := case when ak = 'percent' then round(v_gross * av / 100, 2) else av end;
  end if;

  update public.orders set
    status = 'confirmed',
    client_kind = ck, client_value = cv, client_amount = v_client,
    agent_kind  = ak, agent_value  = av, agent_amount  = v_agent,
    company_amount = v_gross - v_agent,
    confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_order_id;
end $$;

-- 5) RLS + grants ------------------------------------------------------------
alter table public.client_packages   enable row level security;
alter table public.client_package_log enable row level security;

create policy cp_select on public.client_packages for select to authenticated
  using (private.is_active_user() and private.has_perm('clients', 'view'));
create policy cp_insert on public.client_packages for insert to authenticated
  with check (private.is_admin() or private.has_perm('clients', 'edit'));
create policy cp_update on public.client_packages for update to authenticated
  using (private.is_admin() or private.has_perm('clients', 'edit'))
  with check (private.is_admin() or private.has_perm('clients', 'edit'));
create policy cp_delete on public.client_packages for delete to authenticated
  using (private.is_admin() or private.has_perm('clients', 'delete'));

-- log is append-only (written by the trigger only); readable by anyone who can view clients
create policy cpl_select on public.client_package_log for select to authenticated
  using (private.is_active_user() and private.has_perm('clients', 'view'));

grant select, insert, update, delete on public.client_packages   to authenticated, service_role;
grant select                         on public.client_package_log to authenticated;
grant select, insert, update, delete on public.client_package_log to service_role;

-- 6) trigger functions must not be REST-callable RPCs (advisor)
revoke execute on function public.log_client_package_change() from public, anon, authenticated;
revoke execute on function public.orders_snapshot_package()  from public, anon, authenticated;
