-- =============================================================================
-- GraphicSpark CRM - per-agent "commission on/off" switch
--   (applied 2026-08-27; migration crm_agent_commission_toggle)
--
--   profiles.commission_active = false  ->  that agent earns NOTHING on their
--   orders: confirm_order() sets agent_amount = 0 (and agent_kind/value null),
--   so the agent's whole cut stays with GraphicSpark.
--
--   The switch is read LIVE at confirm time (not frozen onto the order), so
--   flipping it changes every still-pending order. Confirmed orders keep their
--   frozen split and are never affected.
--   Only an admin / super_admin can flip it (protect_profile_privileged_fields).
-- =============================================================================

alter table public.profiles
  add column if not exists commission_active boolean not null default true;

-- non-admins still cannot touch their own commission (now incl. the on/off flag)
create or replace function public.protect_profile_privileged_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not private.is_admin() then
    if new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.commission_kind is distinct from old.commission_kind
    or new.commission_value is distinct from old.commission_value
    or new.commission_active is distinct from old.commission_active then
      raise exception 'Not allowed to change role, is_active or commission';
    end if;
  end if;
  return new;
end $$;

-- confirm_order: agent cut only if the agent's commission switch is ON
create or replace function public.confirm_order(p_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  ck text; cv numeric; ak text; av numeric;
  ak_live text; av_live numeric; v_active boolean;
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
