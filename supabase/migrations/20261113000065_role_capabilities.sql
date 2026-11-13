-- Editable access rights (owner, 2026-11-13): the admin decides, per role, which groups of actions it may do and which
-- screens it sees. Enforced by the database: has_role() — used by every permission check and row-level-security rule —
-- now reads this table for the standard permission groups, so switching a group off for a role takes effect everywhere.
-- Defaults reproduce the previous fixed rules exactly. The admin role always keeps every action group (no lock-out).

create table public.role_capabilities (
  id          uuid primary key default gen_random_uuid(),
  role        public.app_role not null,
  capability  text not null,
  allowed     boolean not null default true,
  updated_by  uuid references auth.users (id),
  updated_at  timestamptz not null default now(),
  unique (role, capability)
);
comment on table public.role_capabilities is
  'Per-role access rights. Action groups: enter_records, engineer_tasks, shift_manager_tasks, manager_tasks, admin_tasks. Screens: screen:<path>.';

-- Each action group = the role list the database rules were written with.
create or replace function public.capability_for_roles(roles public.app_role[])
returns text
language sql
immutable
as $$
  select case (select array_agg(distinct r order by r) from unnest(roles) r)
    when (select array_agg(r order by r) from unnest('{operator,engineer,shift_manager,section_manager,admin}'::public.app_role[]) r) then 'enter_records'
    when (select array_agg(r order by r) from unnest('{engineer,shift_manager,section_manager,admin}'::public.app_role[]) r) then 'engineer_tasks'
    when (select array_agg(r order by r) from unnest('{shift_manager,section_manager,admin}'::public.app_role[]) r) then 'shift_manager_tasks'
    when (select array_agg(r order by r) from unnest('{section_manager,admin}'::public.app_role[]) r) then 'manager_tasks'
    when (select array_agg(r order by r) from unnest('{admin}'::public.app_role[]) r) then 'admin_tasks'
  end
$$;

insert into public.role_capabilities (role, capability, allowed)
select r, c.cap, r = any (c.roles)
  from unnest(enum_range(null::public.app_role)) r
 cross join (values
   ('enter_records', '{operator,engineer,shift_manager,section_manager,admin}'::public.app_role[]),
   ('engineer_tasks', '{engineer,shift_manager,section_manager,admin}'::public.app_role[]),
   ('shift_manager_tasks', '{shift_manager,section_manager,admin}'::public.app_role[]),
   ('manager_tasks', '{section_manager,admin}'::public.app_role[]),
   ('admin_tasks', '{admin}'::public.app_role[])) c(cap, roles)
on conflict (role, capability) do nothing;

create or replace function public.has_capability(p_cap text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select rc.allowed from public.role_capabilities rc
                    where rc.role = public.current_app_role() and rc.capability = p_cap), false)
$$;

create or replace function public.has_role(variadic roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case when public.capability_for_roles(roles) is not null
              then public.has_capability(public.capability_for_roles(roles))
              else coalesce(public.current_app_role() = any (roles), false) end
$$;

-- The signed-in user's rights (for the app's menus and buttons).
create or replace function public.my_capabilities()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(capability order by capability), '{}') from public.role_capabilities
   where role = public.current_app_role() and allowed
$$;
revoke execute on function public.my_capabilities() from public, anon;

-- Admin: switch one right on or off for a role.
create or replace function public.set_role_capability(p_role public.app_role, p_cap text, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only an admin can change access rights.' using errcode = 'P0001';
  end if;
  if p_cap not in ('enter_records', 'engineer_tasks', 'shift_manager_tasks', 'manager_tasks', 'admin_tasks') and p_cap !~ '^screen:/[a-z/-]*$' then
    raise exception 'Unknown access right %.', p_cap using errcode = 'P0001';
  end if;
  if p_role = 'admin' and not p_allowed and (p_cap not like 'screen:%' or p_cap = 'screen:/admin') then
    raise exception 'The Admin role always keeps its rights (so nobody is locked out).' using errcode = 'P0001';
  end if;
  perform public.set_change_reason(format('Access right %s %s for %s', p_cap, case when p_allowed then 'given' else 'removed' end, p_role));
  insert into role_capabilities (role, capability, allowed, updated_by) values (p_role, p_cap, p_allowed, auth.uid())
  on conflict (role, capability) do update set allowed = excluded.allowed, updated_by = auth.uid(), updated_at = now();
end;
$$;
revoke execute on function public.set_role_capability(public.app_role, text, boolean) from public, anon;

select public.enable_audit('public.role_capabilities', false);
alter table public.role_capabilities enable row level security;
revoke all on public.role_capabilities from anon;
create policy role_capabilities_read on public.role_capabilities for select to authenticated using (public.is_active_user());
-- written only through set_role_capability

-- AMC planned months follow the "section manager tasks" right (same as the AMC contract editor).
create or replace function public.set_amc_plan_year(p_contract uuid, p_year int, p_months int[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare m int; d date;
begin
  if not public.has_role('admin', 'section_manager') then
    raise exception 'You do not have the right to change the planned months.' using errcode = 'P0001';
  end if;
  if p_year not between 2023 and 2100 then raise exception 'Pick a valid year.' using errcode = 'P0001'; end if;
  perform public.set_change_reason(format('AMC planned months for %s set', p_year));
  for m in 1..12 loop
    d := make_date(p_year, m, 1);
    continue when exists (select 1 from amc_visits where contract_id = p_contract and month = d and voided_at is null);
    if m = any (coalesce(p_months, '{}')) then
      insert into amc_schedule (contract_id, month, planned, updated_by) values (p_contract, d, true, auth.uid())
      on conflict (contract_id, month) do update set planned = true, updated_by = auth.uid(), updated_at = now()
        where amc_schedule.planned is distinct from true;
    else
      update amc_schedule set planned = false, updated_by = auth.uid(), updated_at = now()
       where contract_id = p_contract and month = d and planned;
    end if;
  end loop;
  return cardinality(coalesce(p_months, '{}'));
end;
$$;
revoke execute on function public.set_amc_plan_year(uuid, int, int[]) from public, anon;
