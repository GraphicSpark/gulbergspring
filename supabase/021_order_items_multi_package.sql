-- =============================================================================
-- GraphicSpark CRM - multi-package orders (POS-style line items)
--   (migration crm_order_items_multi_package)
--
-- Before: an order pointed at exactly one package (orders.package_id + the
--   package_name / list_amount / client_kind / client_value snapshot columns),
--   and confirm_order() computed the client cut off that single snapshot.
--
-- After: an order holds many packages in `order_items`, each with its own qty
--   and its own frozen client-cut rate. The order-level totals are unchanged in
--   meaning - they are just SUMMED from the lines:
--     orders.list_amount = Σ line_total  (unit_price * qty)
--     orders.amount      = list_amount - order-level discount   (pending only)
--     orders.package_name / service = a human summary ("Massage x2, Facial")
--   confirm_order() now sums the client cut PER LINE (qty-aware for a fixed cut,
--   % charged on the line's list total). Every Finance ledger keeps reading the
--   order-level columns and is unaffected.
-- =============================================================================

-- ── order_items ─────────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id)          on delete cascade,
  package_id   uuid          references public.client_packages(id) on delete set null,
  package_name text not null,
  unit_price   numeric(12,2) not null default 0 check (unit_price >= 0),
  qty          integer       not null default 1 check (qty > 0),
  client_kind  text check (client_kind in ('fixed','percent')),
  client_value numeric(12,2),
  line_total   numeric(12,2) generated always as (unit_price * qty) stored,
  created_at   timestamptz not null default now()
);
create index if not exists order_items_order_idx   on public.order_items (order_id);
create index if not exists order_items_package_idx on public.order_items (package_id);

grant select, insert, update, delete on public.order_items to authenticated, service_role;

-- an order row is now inserted before its items exist
alter table public.orders alter column service drop not null;

-- ── snapshot a line's package (name / price / client rate) ──────────────────
create or replace function public.order_items_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare pk record;
begin
  -- fill any missing snapshot field from the live package (frontend usually sends
  -- them all; this is the fallback for a bare { package_id } insert)
  if new.package_id is not null then
    select name, price, commission_kind, commission_value into pk
      from public.client_packages where id = new.package_id;
    if found then
      if coalesce(new.package_name, '') = '' then new.package_name := pk.name; end if;
      if coalesce(new.unit_price, 0)   = 0  then new.unit_price   := pk.price; end if;
      if new.client_kind  is null then new.client_kind  := pk.commission_kind; end if;
      if new.client_value is null then new.client_value := pk.commission_value; end if;
    end if;
  end if;
  if coalesce(new.package_name, '') = '' then new.package_name := 'Package'; end if;
  return new;
end $$;
revoke execute on function public.order_items_snapshot() from public, anon, authenticated;

drop trigger if exists trg_order_items_snapshot on public.order_items;
create trigger trg_order_items_snapshot before insert or update on public.order_items
  for each row execute function public.order_items_snapshot();

-- ── recompute the parent order's totals + summary from its lines ────────────
create or replace function public.recompute_order_from_items(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o        public.orders%rowtype;
  v_list   numeric;
  v_disc   numeric;
  v_summary text;
  v_first  uuid;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return; end if;

  select coalesce(sum(line_total), 0),
         string_agg(package_name || case when qty > 1 then ' x' || qty else '' end, ', '
                    order by created_at),
         (array_agg(package_id order by created_at))[1]
    into v_list, v_summary, v_first
    from public.order_items where order_id = p_order_id;

  if o.status = 'pending' then
    v_disc := case
      when o.discount_kind = 'percent' then round(v_list * coalesce(o.discount_value, 0) / 100, 2)
      when o.discount_kind = 'fixed'   then coalesce(o.discount_value, 0)
      else 0 end;

    update public.orders set
      list_amount  = v_list,
      amount       = greatest(v_list - v_disc, 0),
      package_id   = v_first,
      package_name = v_summary,
      service      = coalesce(v_summary, service)
    where id = p_order_id;
  else
    -- confirmed / cancelled: never touch the frozen numbers, just keep list_amount honest
    update public.orders set list_amount = v_list where id = p_order_id;
  end if;
end $$;
revoke execute on function public.recompute_order_from_items(uuid) from public, anon, authenticated;

create or replace function public.order_items_recompute_tg()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recompute_order_from_items(coalesce(new.order_id, old.order_id));
  return null;
end $$;
revoke execute on function public.order_items_recompute_tg() from public, anon, authenticated;

drop trigger if exists trg_order_items_recompute on public.order_items;
create trigger trg_order_items_recompute after insert or update or delete on public.order_items
  for each row execute function public.order_items_recompute_tg();

-- ── orders_snapshot_package: drop the single-package block, keep the rest ───
create or replace function public.orders_snapshot_package()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' then
    -- amount the customer pays = summed list price minus the order-level discount
    if new.list_amount is not null then
      new.amount := greatest(
        new.list_amount - case
          when new.discount_kind = 'percent' then round(new.list_amount * coalesce(new.discount_value, 0) / 100, 2)
          when new.discount_kind = 'fixed'   then coalesce(new.discount_value, 0)
          else 0
        end, 0);
    end if;

    if new.agent_id is not null and (tg_op = 'INSERT' or new.agent_id is distinct from old.agent_id) then
      select commission_kind, commission_value into new.agent_kind, new.agent_value
        from public.profiles where id = new.agent_id;
    end if;
  end if;
  return new;
end $$;

-- ── RLS (mirrors the orders policies) ──────────────────────────────────────
alter table public.order_items enable row level security;

drop policy if exists oi_select on public.order_items;
drop policy if exists oi_insert on public.order_items;
drop policy if exists oi_update on public.order_items;
drop policy if exists oi_delete on public.order_items;

create policy oi_select on public.order_items for select to authenticated
  using (private.is_active_user() and private.has_perm('orders', 'view'));
create policy oi_insert on public.order_items for insert to authenticated
  with check (private.is_admin() or private.has_perm('orders', 'add') or private.has_perm('orders', 'edit'));
create policy oi_update on public.order_items for update to authenticated
  using (private.is_admin() or private.has_perm('orders', 'edit'))
  with check (private.is_admin() or private.has_perm('orders', 'edit'));
create policy oi_delete on public.order_items for delete to authenticated
  using (private.is_admin() or private.has_perm('orders', 'edit'));

-- ── confirm_order: client cut summed PER LINE ──────────────────────────────
create or replace function public.confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  ck text; cv numeric; ak text; av numeric;
  ak_live text; av_live numeric; v_active boolean;
  v_list numeric; v_client numeric; v_gross numeric; v_agent numeric;
  v_has_items boolean;
begin
  if not (private.current_user_role() = 'super_admin'
          or private.is_admin()
          or private.has_perm('orders', 'confirm')) then
    raise exception 'Not allowed to confirm orders';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending' then raise exception 'Order is % - only pending orders can be confirmed', o.status; end if;

  v_list := coalesce(o.list_amount, o.amount);   -- Sales (summed list price, before discount)
  select exists (select 1 from public.order_items where order_id = p_order_id) into v_has_items;

  if v_has_items then
    select coalesce(sum(
      case
        when coalesce(i.client_kind, cp.commission_kind, 'fixed') = 'percent'
          then round(i.line_total * coalesce(i.client_value, cp.commission_value, 0) / 100, 2)
        else coalesce(i.client_value, cp.commission_value, 0) * i.qty
      end), 0)
    into v_client
    from public.order_items i
    left join public.client_packages cp on cp.id = i.package_id
    where i.order_id = p_order_id;
  else
    -- legacy single-package fallback (pre-021 orders with no lines)
    ck := coalesce(o.client_kind,  (select commission_kind  from public.clients where id = o.client_id));
    cv := coalesce(o.client_value, (select commission_value from public.clients where id = o.client_id), 0);
    v_client := case when ck = 'percent' then round(v_list * cv / 100, 2) else cv end;
  end if;

  if coalesce(v_list, 0) = 0 then raise exception 'Order has no packages'; end if;

  v_gross := o.amount - v_client;   -- GS gross net of the discount

  v_agent := 0; ak := null; av := null;
  if o.agent_id is not null then
    select commission_active, commission_kind, commission_value
      into v_active, ak_live, av_live
      from public.profiles where id = o.agent_id;
    if coalesce(v_active, true) then
      ak := coalesce(o.agent_kind,  ak_live);
      av := coalesce(o.agent_value, av_live, 0);
      v_agent := case when ak = 'percent' then round(v_gross * av / 100, 2) else av end;
    end if;
  end if;

  update public.orders set
    status = 'confirmed',
    client_amount = v_client,
    agent_kind  = ak, agent_value  = av, agent_amount  = v_agent,
    company_amount = v_gross - v_agent,
    confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_order_id;
end $$;
revoke execute on function public.confirm_order(uuid) from public, anon;
grant  execute on function public.confirm_order(uuid) to authenticated;

-- ── backfill: one line per existing order ──────────────────────────────────
insert into public.order_items (order_id, package_id, package_name, unit_price, qty, client_kind, client_value)
select o.id, o.package_id, coalesce(nullif(o.package_name, ''), nullif(o.service, ''), 'Package'),
       coalesce(o.list_amount, o.amount, 0), 1, o.client_kind, o.client_value
from public.orders o
where not exists (select 1 from public.order_items i where i.order_id = o.id);

-- ── self-check: silent on success, aborts the migration on failure ─────────
do $$
declare
  n_orders int; n_missing int;
  test_order uuid; c uuid; cust uuid; acc uuid;
  v_list numeric; v_client numeric;
begin
  select count(*) into n_orders from public.orders;
  select count(*) into n_missing from public.orders o
    where not exists (select 1 from public.order_items i where i.order_id = o.id);
  if n_orders > 0 and n_missing > 0 then
    raise exception 'SMOKETEST: % order(s) have no order_items after backfill', n_missing;
  end if;

  select id into c    from public.clients   limit 1;
  select id into cust from public.customers limit 1;
  select id into acc  from public.accounts  limit 1;
  if c is null or cust is null or acc is null then
    raise notice 'SMOKETEST: skipped line math (no client/customer/account seeded)';
    return;
  end if;

  insert into public.orders (account_id, customer_id, client_id, status)
    values (acc, cust, c, 'pending') returning id into test_order;

  -- line 1: fixed Rs 300 client cut, qty 2, unit 1000  -> line_total 2000, client 600
  insert into public.order_items (order_id, package_name, unit_price, qty, client_kind, client_value)
    values (test_order, 'T1', 1000, 2, 'fixed', 300);
  -- line 2: 10% client cut, qty 1, unit 500  -> line_total 500, client 50
  insert into public.order_items (order_id, package_name, unit_price, qty, client_kind, client_value)
    values (test_order, 'T2', 500, 1, 'percent', 10);

  select list_amount into v_list from public.orders where id = test_order;
  if v_list <> 2500 then raise exception 'SMOKETEST: list_amount % <> 2500', v_list; end if;

  select coalesce(sum(
    case when coalesce(i.client_kind,'fixed') = 'percent'
         then round(i.line_total * coalesce(i.client_value,0) / 100, 2)
         else coalesce(i.client_value,0) * i.qty end), 0)
  into v_client from public.order_items i where i.order_id = test_order;
  if v_client <> 650 then raise exception 'SMOKETEST: per-line client cut % <> 650', v_client; end if;

  delete from public.orders where id = test_order;  -- cascades to order_items
  raise notice 'SMOKETEST ok';
end $$;
