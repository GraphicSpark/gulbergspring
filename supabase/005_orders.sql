-- =============================================================================
-- GraphicSpark CRM - Orders + commission split  (applied 2026-08-27)
--   Migrations: crm_perm_action_add_confirm, crm_orders_and_commissions
--
--   Spa referral model:
--     Customer pays `amount`.
--     Client is paid commission_value (fixed Rs) or a % of amount.
--     GraphicSpark gross = amount - client_amount.
--     Agent (order creator) gets fixed Rs or a % of the GraphicSpark gross.
--     GraphicSpark net = gross - agent_amount.
--   The split is frozen when the order is confirmed (confirm_order()).
-- =============================================================================

-- 1) new permission action (run alone before anything uses it)
alter type public.perm_action add value if not exists 'confirm';

-- 2) numeric display IDs (start 10001, own sequence per table)
alter table public.customers add column if not exists ref_no bigint generated always as identity (start with 10001);
alter table public.clients   add column if not exists ref_no bigint generated always as identity (start with 10001);

-- 3) commission config
alter table public.clients
  add column if not exists commission_kind  text          not null default 'fixed',
  add column if not exists commission_value numeric(12,2) not null default 0;
alter table public.clients add constraint clients_commission_kind_chk check (commission_kind in ('fixed','percent'));

alter table public.profiles
  add column if not exists commission_kind  text          not null default 'fixed',
  add column if not exists commission_value numeric(12,2) not null default 0;
alter table public.profiles add constraint profiles_commission_kind_chk check (commission_kind in ('fixed','percent'));

-- non-admins may not change their own role / is_active / commission
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not private.is_admin() then
    if new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.commission_kind is distinct from old.commission_kind
    or new.commission_value is distinct from old.commission_value then
      raise exception 'Not allowed to change role, is_active or commission';
    end if;
  end if;
  return new;
end $$;

-- 4) orders
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  ref_no        bigint generated always as identity (start with 10001),
  customer_id   uuid not null references public.customers(id)       on delete restrict,
  client_id     uuid not null references public.clients(id)         on delete restrict,
  branch_id     uuid          references public.client_branches(id) on delete set null,
  agent_id      uuid          references public.profiles(id)        on delete set null default auth.uid(),
  service       text not null,
  amount        numeric(12,2) not null default 0 check (amount >= 0),
  status        text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  notes         text,
  client_kind   text, client_value numeric(12,2), client_amount numeric(12,2),
  agent_kind    text, agent_value  numeric(12,2), agent_amount  numeric(12,2),
  company_amount numeric(12,2),
  confirmed_at  timestamptz,
  confirmed_by  uuid references public.profiles(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_client_idx   on public.orders (client_id);
create index if not exists orders_agent_idx    on public.orders (agent_id);
create index if not exists orders_status_idx   on public.orders (status);

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

alter table public.orders enable row level security;
create policy o_select on public.orders for select to authenticated
  using (private.is_active_user() and private.has_perm('orders', 'view'));
create policy o_insert on public.orders for insert to authenticated
  with check (private.is_admin() or private.has_perm('orders', 'add'));
create policy o_update on public.orders for update to authenticated
  using (private.is_admin() or private.has_perm('orders', 'edit'))
  with check (private.is_admin() or private.has_perm('orders', 'edit'));
create policy o_delete on public.orders for delete to authenticated
  using (private.is_admin() or private.has_perm('orders', 'delete'));

-- 5) confirm_order() - gated by orders.confirm, computes + freezes the split
--    (SECURITY DEFINER by design; it does its own permission check. The Supabase
--    advisor flags this as "signed-in users can execute" - that is intentional.)
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

  select commission_kind, commission_value into ck, cv from public.clients where id = o.client_id;
  v_client := case when ck = 'percent' then round(o.amount * cv / 100, 2) else cv end;
  v_gross  := o.amount - v_client;

  v_agent := 0; ak := null; av := null;
  if o.agent_id is not null then
    select commission_kind, commission_value into ak, av from public.profiles where id = o.agent_id;
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
revoke execute on function public.confirm_order(uuid) from public, anon;
grant  execute on function public.confirm_order(uuid) to authenticated;

-- 6) seed orders permissions (super_admin bypasses)
insert into public.role_permissions (role, page, action, allowed) values
  ('admin','orders','view',true),('admin','orders','add',true),('admin','orders','edit',true),('admin','orders','delete',true),('admin','orders','confirm',true),
  ('agent','orders','view',true),('agent','orders','add',true),('agent','orders','edit',true),('agent','orders','delete',false),('agent','orders','confirm',false),
  ('ops','orders','view',true),('ops','orders','add',false),('ops','orders','edit',false),('ops','orders','delete',false),('ops','orders','confirm',false)
on conflict (role, page, action) do nothing;

-- 7) grants
grant select, insert, update, delete on public.orders to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
