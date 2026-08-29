-- =============================================================================
-- GraphicSpark CRM - the per-order DISCOUNT is GraphicSpark's concession.
--   (applied 2026-08-30; migration crm_confirm_order_client_pct_on_sales)
--
--   A % client cut is now charged on SALES (the package list price), NOT on the
--   discounted amount. The client is never affected by a discount.
--     Sales - Client cut  = GS gross   (GraphicSpark margin, pre-discount)
--     GS gross - Discount = GS net     (what the client owes GraphicSpark)
--     GS net - Agent cut  = Net
--   Only confirm_order() changed (one line: v_client base = list_amount, not
--   amount). Existing confirmed orders keep their frozen split.
-- =============================================================================

create or replace function public.confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  ck text; cv numeric; ak text; av numeric;
  ak_live text; av_live numeric; v_active boolean;
  v_list numeric; v_client numeric; v_gross numeric; v_agent numeric;
begin
  if not (private.current_user_role() = 'super_admin'
          or private.is_admin()
          or private.has_perm('orders', 'confirm')) then
    raise exception 'Not allowed to confirm orders';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'pending' then raise exception 'Order is % - only pending orders can be confirmed', o.status; end if;

  v_list := coalesce(o.list_amount, o.amount);   -- Sales (list price, before discount)

  ck := coalesce(o.client_kind,  (select commission_kind  from public.clients where id = o.client_id));
  cv := coalesce(o.client_value, (select commission_value from public.clients where id = o.client_id), 0);
  v_client := case when ck = 'percent' then round(v_list * cv / 100, 2) else cv end;

  v_gross := o.amount - v_client;   -- GS gross net of the discount ( = (Sales-Client) - Discount )

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
    client_kind = ck, client_value = cv, client_amount = v_client,
    agent_kind  = ak, agent_value  = av, agent_amount  = v_agent,
    company_amount = v_gross - v_agent,
    confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_order_id;
end $$;
revoke execute on function public.confirm_order(uuid) from public, anon;
grant  execute on function public.confirm_order(uuid) to authenticated;
