-- =============================================================================
-- GraphicSpark CRM - custom roles + multi-role users
--   (migration crm_custom_roles_multi_role)
--
-- Before: roles were the fixed enum `user_role` (super_admin/admin/agent/ops).
--   `profiles.role` was the single source of a user's permissions and
--   `role_permissions.role` was keyed by that enum.
--
-- After:
--   * `public.roles`        - the role catalogue (4 system rows + any custom rows
--                             a Super Admin adds from the Role Access page).
--   * `public.user_roles`   - many-to-many: a user can hold several roles and gets
--                             the UNION of every permission any of them grants.
--   * `role_permissions.role` is now `text` -> `roles.key` (on delete cascade).
--   * `private.has_perm()`  ORs `allowed` across the caller's `user_roles`.
--   * `profiles.role` stays as a DERIVED "primary" (most-privileged system role
--     the user holds, else 'agent'), kept in sync by `trg_user_roles_sync`, so
--     `current_user_role()` / `is_admin()` / the super-admin bypass and every
--     existing policy keep working untouched. Custom roles never grant the
--     `is_admin()` RLS bypass - only the built-in admin / super_admin do.
--
-- New pages no longer need to seed `role_permissions` in their migration: an
-- unseeded (page, action) coalesces to false for every non-super role and the
-- Role Access grid can switch it on.
-- =============================================================================

-- ── role catalogue ──────────────────────────────────────────────────────────
create table if not exists public.roles (
  key        text primary key,
  label      text not null,
  is_system  boolean not null default false,
  sort       integer not null default 100,
  created_at timestamptz not null default now()
);

insert into public.roles (key, label, is_system, sort) values
  ('super_admin', 'Super Admin', true, 0),
  ('admin',       'Admin',       true, 10),
  ('agent',       'Agent',       true, 20),
  ('ops',         'Ops',         true, 30)
on conflict (key) do nothing;

-- ── user <-> role assignments (multi) ───────────────────────────────────────
create table if not exists public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role    text not null references public.roles(key)   on delete cascade,
  primary key (user_id, role)
);
create index if not exists user_roles_role_idx on public.user_roles (role);

-- backfill from the current single role
insert into public.user_roles (user_id, role)
  select id, role::text from public.profiles
on conflict do nothing;

grant select, insert, update, delete on public.roles      to authenticated, service_role;
grant select, insert, update, delete on public.user_roles to authenticated, service_role;

-- ── role_permissions.role : enum -> text + FK ───────────────────────────────
alter table public.role_permissions drop constraint role_permissions_pkey;
alter table public.role_permissions alter column role type text using role::text;
alter table public.role_permissions add primary key (role, page, action);
alter table public.role_permissions
  add constraint role_permissions_role_fkey
  foreign key (role) references public.roles(key) on delete cascade;

-- ── keep profiles.role as the derived "primary" role ────────────────────────
create or replace function public.sync_primary_role()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := coalesce(new.user_id, old.user_id);
  best text;
begin
  select ur.role into best
    from public.user_roles ur
    join public.roles r on r.key = ur.role
   where ur.user_id = uid
     and ur.role in ('super_admin', 'admin', 'agent', 'ops')
   order by r.sort
   limit 1;

  update public.profiles
     set role = coalesce(best, 'agent')::public.user_role
   where id = uid;

  return null;
end $$;

drop trigger if exists trg_user_roles_sync on public.user_roles;
create trigger trg_user_roles_sync
  after insert or delete on public.user_roles
  for each row execute function public.sync_primary_role();

-- ── has_perm: OR across every role the caller holds ─────────────────────────
-- super_admin -> true; else user override; else ANY of the user's roles grants
-- it; else false.  (Signature unchanged, so no policy has to be dropped.)
create or replace function private.has_perm(p_page text, p_action public.perm_action)
returns boolean language sql stable security definer set search_path = public as $$
  select
    private.current_user_role() = 'super_admin'
    or coalesce(
      (select allowed from public.user_permissions
         where user_id = auth.uid() and page = p_page and action = p_action),
      (select bool_or(rp.allowed)
         from public.role_permissions rp
         join public.user_roles ur on ur.role = rp.role
        where ur.user_id = auth.uid()
          and rp.page = p_page and rp.action = p_action),
      false
    );
$$;
revoke execute on function private.has_perm(text, public.perm_action) from public, anon;
grant  execute on function private.has_perm(text, public.perm_action) to authenticated;

-- ── protect the built-in roles ─────────────────────────────────────────────
create or replace function public.protect_system_roles()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'System roles cannot be deleted';
    end if;
    return old;
  end if;
  -- UPDATE
  if old.is_system and (new.key is distinct from old.key
                        or new.is_system is distinct from old.is_system) then
    raise exception 'A system role''s key cannot be changed';
  end if;
  return new;
end $$;

drop trigger if exists trg_roles_protect on public.roles;
create trigger trg_roles_protect
  before update or delete on public.roles
  for each row execute function public.protect_system_roles();

-- trigger fns are not meant to be REST-callable
revoke execute on function public.sync_primary_role()   from public, anon, authenticated;
revoke execute on function public.protect_system_roles() from public, anon, authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.roles      enable row level security;
alter table public.user_roles enable row level security;

create policy roles_select on public.roles for select to authenticated
  using (private.is_active_user());
create policy roles_super on public.roles for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

create policy ur_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or private.current_user_role() = 'super_admin');
create policy ur_super on public.user_roles for all to authenticated
  using (private.current_user_role() = 'super_admin')
  with check (private.current_user_role() = 'super_admin');

-- ── self-checks (silent on success, abort the migration on failure) ─────────
do $$
declare n_profiles int; n_user_roles int;
begin
  select count(*) into n_profiles   from public.profiles;
  select count(*) into n_user_roles from public.user_roles;
  if n_user_roles < n_profiles then
    raise exception 'SMOKETEST: user_roles backfill missing (% profiles, % user_roles)',
      n_profiles, n_user_roles;
  end if;

  begin
    delete from public.roles where key = 'ops';
    raise exception 'SMOKETEST: system role delete was allowed';
  exception
    when others then
      if sqlerrm not like '%System roles cannot be deleted%' then raise; end if;
  end;
end $$;
