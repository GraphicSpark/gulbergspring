-- =============================================================================
-- GraphicSpark CRM - confirm_order() reads the agent's commission LIVE
--   (migration crm_confirm_order_live_agent_commission)
--
-- Bug: confirm_order() used `coalesce(o.agent_value, av_live, 0)` - and
-- `orders.agent_kind/value` is snapshotted from the agent's profile the moment
-- the order is CREATED (by `orders_snapshot_package`). That snapshot is never
-- null, so a commission set/changed on the agent's profile AFTER the order was
-- created had no effect, even on a still-pending order. That contradicts the
-- intended "the commission is read LIVE at confirm" behaviour.
--
-- Fix: confirm_order() now takes `commission_kind` / `commission_value` straight
-- from `public.profiles` (live) and no longer reads the order's own snapshot for
-- the agent cut. It still WRITES the resolved values onto `orders.agent_kind /
-- agent_value / agent_amount` so a confirmed order stays a frozen record.
-- `commission_active` was already read live. The client cut (per-package,
-- `order_items` snapshot) and everything else are unchanged.
-- =============================================================================

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

  v_list := coalesce(o.list_amount, o.amount);
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
    ck := coalesce(o.client_kind,  (select commission_kind  from public.clients where id = o.client_id));
    cv := coalesce(o.client_value, (select commission_value from public.clients where id = o.client_id), 0);
    v_client := case when ck = 'percent' then round(v_list * cv / 100, 2) else cv end;
  end if;

  if coalesce(v_list, 0) = 0 then raise exception 'Order has no packages'; end if;

  v_gross := o.amount - v_client;

  v_agent := 0; ak := null; av := null;
  if o.agent_id is not null then
    select commission_active, commission_kind, commission_value
      into v_active, ak_live, av_live
      from public.profiles where id = o.agent_id;
    if coalesce(v_active, true) then
      ak := coalesce(ak_live, 'fixed');   -- LIVE from the agent's profile, not the order snapshot
      av := coalesce(av_live, 0);
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
