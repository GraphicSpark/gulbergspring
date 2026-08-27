-- =============================================================================
-- GraphicSpark CRM - package list price + per-order discount
--   (applied 2026-08-27; migrations crm_package_price_and_order_discount,
--    crm_backfill_orders_list_amount)
--
--   client_packages.price       = the package's sticker price (Rs)
--   orders.list_amount          = snapshot of that price when the order was made
--   orders.discount_kind/value  = 'none' | 'fixed' (Rs off) | 'percent' (% off)
--   orders.amount               = DERIVED by the trg_orders_snapshot trigger:
--                                 list_amount - discount, floored at 0. This is
--                                 "what the customer pays" and every split
--                                 calculation uses it.
--
--   A percentage client-commission package therefore charges its % on the
--   DISCOUNTED amount (confirm_order() already reads orders.amount - unchanged).
--   A fixed client-commission package is unaffected by the discount.
-- =============================================================================

alter table public.client_packages
  add column if not exists price numeric(12,2) not null default 0 check (price >= 0);

alter table public.orders
  add column if not exists list_amount    numeric(12,2),
  add column if not exists discount_kind  text not null default 'none'
    check (discount_kind in ('none','fixed','percent')),
  add column if not exists discount_value numeric(12,2) not null default 0 check (discount_value >= 0);

-- snapshot package (name + rate + price) and derive amount from list price - discount
create or replace function public.orders_snapshot_package()
returns trigger language plpgsql security definer set search_path = public as $$
declare pk record;
begin
  if new.status = 'pending' then
    if new.package_id is not null and (tg_op = 'INSERT' or new.package_id is distinct from old.package_id) then
      select name, commission_kind, commission_value, price
        into pk from public.client_packages where id = new.package_id;
      new.package_name := pk.name;
      new.client_kind  := pk.commission_kind;
      new.client_value := pk.commission_value;
      new.list_amount  := pk.price;
      if coalesce(new.service, '') = '' then new.service := pk.name; end if;
    end if;

    -- amount the customer pays = list price minus the order discount
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
revoke execute on function public.orders_snapshot_package() from public, anon, authenticated;

-- one-time backfill so existing orders show a list price
update public.orders set list_amount = amount where list_amount is null;
