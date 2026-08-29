-- =============================================================================
-- GraphicSpark CRM - payout tracking
--   (applied 2026-08-30; migration crm_payouts)
--
--   Records money settled with a party. party='client' = money IN (the client
--   pays us what they owe = amount - client cut); party='agent' = money OUT
--   (we pay the agent their cut). The Client Ledger shows Receivable - Received
--   = Outstanding; the Agent Ledger shows Owed - Paid = Outstanding.
--   Surfaced in the UI as the "Settlements" page (src/pages/Settlements.jsx).
--   `finance` permission gains add/edit/delete (was view only); admin-only.
-- =============================================================================

create table if not exists public.payouts (
  id          uuid primary key default gen_random_uuid(),
  ref_no      bigint not null default nextval('public.ref_no_seq'),
  party       text not null check (party in ('client','agent')),
  client_id   uuid references public.clients(id)  on delete set null,
  agent_id    uuid references public.profiles(id) on delete set null,
  amount      numeric(12,2) not null check (amount > 0),
  paid_on     date not null default current_date,
  method      text,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.payouts add constraint payouts_party_ref_chk check (
  (party = 'client' and client_id is not null and agent_id is null) or
  (party = 'agent'  and agent_id  is not null and client_id is null)
);
create index if not exists payouts_client_idx on public.payouts (client_id);
create index if not exists payouts_agent_idx  on public.payouts (agent_id);

alter table public.payouts enable row level security;
create policy pay_select on public.payouts for select to authenticated
  using (private.is_active_user() and private.has_perm('finance', 'view'));
create policy pay_insert on public.payouts for insert to authenticated
  with check (private.is_admin() or private.has_perm('finance', 'add'));
create policy pay_update on public.payouts for update to authenticated
  using (private.is_admin() or private.has_perm('finance', 'edit'))
  with check (private.is_admin() or private.has_perm('finance', 'edit'));
create policy pay_delete on public.payouts for delete to authenticated
  using (private.is_admin() or private.has_perm('finance', 'delete'));

grant select, insert, update, delete on public.payouts to authenticated, service_role;

insert into public.role_permissions (role, page, action, allowed) values
  ('admin','finance','add',true),('admin','finance','edit',true),('admin','finance','delete',true),
  ('agent','finance','add',false),('agent','finance','edit',false),('agent','finance','delete',false),
  ('ops','finance','add',false),('ops','finance','edit',false),('ops','finance','delete',false)
on conflict (role, page, action) do nothing;
