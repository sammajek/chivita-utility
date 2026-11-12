-- Downtime rework (owner, 2026-11-12)
--  * Cause tree per machine type: downtime type -> failure category -> failure mode -> suggested issue descriptions
--    (table downtime_causes; rows with no equipment category apply to every machine). Editable by the section manager.
--  * Types: Unplanned Breakdown, Condition-Based Maintenance (CBM), Planned Maintenance, External Supply Failure.
--    "Idle / Standby" is no longer downtime (equipment status covers it); old events keep their type.
--  * CBM records whether the machine had to stop at once (immediate_stop); planned work records the planned duration
--    (planned_hours) so only the overrun counts as an availability loss.
--  * RCA: automatic only for unplanned breakdowns (>= 4 h or >= 3 repeats) and CBM repeats (>= 3), never for planned
--    work or external supply failures. A draft RCA is created and assigned to the engineer on duty.

create table public.downtime_causes (
  id                 uuid primary key default gen_random_uuid(),
  downtime_type      text not null,
  equipment_category text,
  failure_category   text not null,
  failure_mode       text not null,
  issue_descriptions text[] not null default '{}',
  sort               int not null default 0,
  active             boolean not null default true
);
create unique index downtime_causes_key on public.downtime_causes (downtime_type, coalesce(equipment_category, ''), failure_category, failure_mode);
select public.enable_audit('public.downtime_causes', false);
alter table public.downtime_causes enable row level security;
revoke all on public.downtime_causes from anon;
create policy downtime_causes_read on public.downtime_causes for select to authenticated using (public.is_active_user());
create policy downtime_causes_write on public.downtime_causes for all to authenticated
  using (public.has_role('admin', 'section_manager')) with check (public.has_role('admin', 'section_manager'));

-- Loads seed_data/downtime_causes.json (adds missing rows; never overwrites edits).
create or replace function public.load_downtime_causes(p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can load downtime causes.' using errcode = 'P0001';
  end if;
  insert into downtime_causes (downtime_type, equipment_category, failure_category, failure_mode, issue_descriptions, sort)
  select x->>'type', x->>'equip', x->>'category', x->>'mode',
         coalesce(array(select jsonb_array_elements_text(x->'issues')), '{}'), (x->>'sort')::int
    from jsonb_array_elements(p->'causes') x
  on conflict (downtime_type, coalesce(equipment_category, ''), failure_category, failure_mode) do nothing;
  get diagnostics n = row_count;
  insert into lists (list_name, value, sort) select 'downtime_type', t, o::int from jsonb_array_elements_text(p->'types') with ordinality v(t, o)
  on conflict (list_name, value) do update set active = true, sort = excluded.sort;
  insert into app_settings (key, value, description)
  values ('downtime_general_issues', p->'general_issues', 'Issue descriptions offered for every downtime cause (plus each cause''s own).')
  on conflict (key) do nothing;
  return n;
end;
$$;
revoke execute on function public.load_downtime_causes(jsonb) from public, anon, authenticated;

update public.lists set active = false where list_name = 'downtime_type' and value = 'Idle / Standby';

alter table public.downtime_events add column if not exists immediate_stop boolean not null default false;
alter table public.downtime_events add column if not exists planned_hours numeric check (planned_hours is null or planned_hours > 0);

-- Hours that count against availability (OEE), planned hours (taken out of scheduled time) and external hours.
create or replace function public.downtime_split(e public.downtime_events, out loss_hours numeric, out planned_hours numeric, out external_hours numeric)
language sql
stable
as $$
  with h as (select public.downtime_hours(e) as hrs)
  select case when e.downtime_type = 'Unplanned Breakdown' then h.hrs
              when e.downtime_type = 'Condition-Based Maintenance (CBM)' and e.immediate_stop then h.hrs
              when e.downtime_type in ('Planned Maintenance', 'Condition-Based Maintenance (CBM)') and e.planned_hours is not null
                then greatest(h.hrs - e.planned_hours, 0)
              else 0 end,
         case when e.downtime_type = 'Planned Maintenance' or (e.downtime_type = 'Condition-Based Maintenance (CBM)' and not e.immediate_stop)
                then least(h.hrs, coalesce(e.planned_hours, h.hrs)) else 0 end,
         case when e.downtime_type = 'External Supply Failure' then h.hrs else 0 end
    from h;
$$;

create or replace function public.downtime_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  hrs     numeric;
  repeats int;
  h_lim   numeric := public.setting_num('rca_hours_at_or_above', 4);
  r_lim   numeric := public.setting_num('rca_repeats_at_or_above', 3);
  cat     text;
  changed boolean := tg_op = 'INSERT' or new.downtime_type is distinct from old.downtime_type or new.failure_category is distinct from old.failure_category
                     or new.failure_mode is distinct from old.failure_mode or new.asset_id is distinct from old.asset_id;
begin
  if changed and not new.is_demo then  -- demo rows (generator) still use the old flat lists
    if not exists (select 1 from lists where list_name = 'downtime_type' and value = new.downtime_type and active) then
      raise exception 'Unknown downtime type: %', new.downtime_type using errcode = 'P0001';
    end if;
    select c.name into cat from assets a join asset_categories c on c.id = a.category_id where a.id = new.asset_id;
    if not exists (select 1 from downtime_causes d
                    where d.active and d.downtime_type = new.downtime_type and d.failure_category = new.failure_category
                      and d.failure_mode = new.failure_mode and (d.equipment_category is null or d.equipment_category = cat)) then
      raise exception '"%" / "%" is not a % cause for this equipment.', new.failure_category, new.failure_mode, lower(new.downtime_type)
        using errcode = 'P0001';
    end if;
  end if;
  if not exists (select 1 from lists where list_name = 'downtime_status' and value = new.status) then
    raise exception 'Unknown status: %', new.status using errcode = 'P0001';
  end if;
  if new.status = 'Closed' and new.end_at is null then
    raise exception 'Enter the end time before closing the event.' using errcode = 'P0001';
  end if;
  if new.downtime_type <> 'Condition-Based Maintenance (CBM)' then new.immediate_stop := false; end if;
  if new.downtime_type not in ('Planned Maintenance', 'Condition-Based Maintenance (CBM)') then new.planned_hours := null; end if;

  new.area := coalesce(new.area, (select area from assets where id = new.asset_id));
  new.reading_for := new.start_at;

  hrs := public.downtime_hours(new);
  select count(*) into repeats from downtime_events
   where asset_id = new.asset_id and failure_mode = new.failure_mode and voided_at is null
     and downtime_type in ('Unplanned Breakdown', 'Condition-Based Maintenance (CBM)')
     and id <> new.id and start_at > new.start_at - interval '365 days';
  repeats := repeats + 1;

  new.rca_required := new.voided_at is null and (
       (new.downtime_type = 'Unplanned Breakdown' and (hrs >= h_lim or repeats >= r_lim))
    or (new.downtime_type = 'Condition-Based Maintenance (CBM)' and repeats >= r_lim));
  new.rca_reason := case
    when not new.rca_required then null
    when new.downtime_type = 'Unplanned Breakdown' and hrs >= h_lim and repeats >= r_lim then format('%s h (≥ %s h) and %s repeats (≥ %s)', hrs, h_lim, repeats, r_lim)
    when new.downtime_type = 'Unplanned Breakdown' and hrs >= h_lim then format('%s h (≥ %s h)', hrs, h_lim)
    else format('%s repeats of "%s" on this equipment in 12 months (≥ %s)', repeats, new.failure_mode, r_lim) end;
  return new;
end;
$$;

-- When an event first needs an RCA, open a draft RCA for the engineer on duty in that area (else whoever logged it,
-- if engineer or above), with a target date (setting rca_target_days, default 14).
create or replace function public.downtime_draft_rca()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare owner uuid; days int := public.setting_num('rca_target_days', 14)::int; a public.assets;
begin
  if new.is_demo or not new.rca_required or (tg_op = 'UPDATE' and old.rca_required) then return null; end if;
  if exists (select 1 from rcas where downtime_id = new.id and voided_at is null) then return null; end if;
  select * into a from assets where id = new.asset_id;
  select s.profile_id into owner
    from duty_sessions s join profiles p on p.id = s.profile_id
   where s.checked_out_at is null and not s.is_demo and (a.area is null or a.area = any (s.areas))
     and p.role in ('engineer', 'shift_manager', 'section_manager')
   order by (p.role = 'engineer') desc, s.checked_in_at desc limit 1;
  if owner is null then
    select p.id into owner from profiles p where p.id = new.recorded_by_id and p.role in ('engineer', 'shift_manager', 'section_manager', 'admin');
  end if;
  insert into rcas (downtime_id, asset_id, problem, owner_id, target_date, status, created_by)
  values (new.id, new.asset_id,
          format('%s on %s: %s – %s%s. Automatic draft (%s).', new.downtime_type, a.code, new.failure_category, new.failure_mode,
                 coalesce(' (' || new.issue_description || ')', ''), new.rca_reason),
          owner, (public.lagos_now()::date + days), 'Not Started', coalesce(auth.uid(), new.recorded_by_id));
  return null;
end;
$$;
revoke execute on function public.downtime_draft_rca() from public, anon, authenticated;
create trigger downtime_draft_rca after insert or update on public.downtime_events
  for each row execute function public.downtime_draft_rca();

insert into public.app_settings (key, value, description) values
  ('rca_target_days', '14'::jsonb, 'Days from an automatic draft RCA to its target date.')
on conflict (key) do nothing;

-- Engineer KPI "availability on my shift": count urgent CBM stops as well as breakdowns.
create or replace function public.engineer_kpi_auto(p_profile uuid, p_year int)
returns table (month date, kpi text, num numeric, den numeric)
language sql
stable
security definer
set search_path = public
as $$
  with months as (
    select make_date(p_year, m, 1) as m0, (make_date(p_year, m, 1) + interval '1 month')::date as m1 from generate_series(1, 12) m
  ),
  sess as (   -- my duty shifts with their 12-hour window
    select d.*, public.lagos_ts(d.shift_date, case d.shift when 'day' then time '07:00' else time '19:00' end) as w0,
           public.lagos_ts(d.shift_date, case d.shift when 'day' then time '07:00' else time '19:00' end) + interval '12 hours' as w1
      from public.duty_sessions d where d.profile_id = p_profile and extract(year from d.shift_date) = p_year
  ),
  my_areas as (select coalesce((select areas from public.profiles where id = p_profile), '{U1,U2}') as areas),
  quality as (
    select date_trunc('month', s.shift_date)::date as m0,
           case when p.name ilike 'cooling water%temp%' then 'cw_temp'
                when p.name ilike '%dew point%' then 'dew_point'
                when p.equipment_group ilike '%water%' and (p.name ~* '(tds|conductiv|hardness|ph\M|turbid|chlorin)') then 'water_quality'
                when p.name ~* '(feed ?water|cooling tower|treated water|raw water).*(tds|conductiv|hardness|ph\M|turbid|chlorin)' then 'water_quality'
           end as kpi,
           r.status
      from sess s
      join public.readings r on r.reading_for >= s.w0 and r.reading_for < s.w1 and r.voided_at is null
      join public.registers g on g.id = r.register_id and g.area = any (s.areas)
      join public.parameters p on p.id = r.parameter_id
     where r.status in ('ok', 'out_of_spec', 'critical')
  ),
  q as (
    select m0, kpi, count(*) filter (where status = 'ok')::numeric as num, count(*)::numeric as den
      from quality where kpi is not null group by m0, kpi
  ),
  leak_checks as (
    select r.field_id, r.asset_id, r.register_id, r.reading_for, r.value_text,
           lag(r.value_text) over (partition by r.field_id, r.asset_id order by r.reading_for) as prev_value
      from public.readings r join public.parameters p on p.id = r.parameter_id
     where p.data_type = 'select' and 'Leak' = any (p.options) and r.voided_at is null
       and r.reading_for >= make_date(p_year, 1, 1) - interval '2 days' and r.reading_for < make_date(p_year + 1, 1, 1)
  ),
  leaks as (
    select date_trunc('month', s.shift_date)::date as m0,
           exists (select 1 from public.readings x
                    where x.field_id = l.field_id and x.asset_id = l.asset_id and x.voided_at is null
                      and x.reading_for > l.reading_for and x.reading_for <= l.reading_for + interval '24 hours'
                      and x.value_text = 'No Leak') as closed
      from leak_checks l
      join sess s on l.reading_for >= s.w0 and l.reading_for < s.w1
      join public.registers g on g.id = l.register_id and g.area = any (s.areas)
     where l.value_text = 'Leak' and coalesce(l.prev_value, '') <> 'Leak'
  ),
  avail as (
    select date_trunc('month', s.shift_date)::date as m0,
           sum(12.0 * (select count(*) from public.assets a where a.status <> 'retired' and a.area = any (s.areas))) as den,
           sum(coalesce((select sum(extract(epoch from (least(coalesce(e.end_at, now()), s.w1) - greatest(e.start_at, s.w0))) / 3600.0)
                           from public.downtime_events e join public.assets a on a.id = e.asset_id
                          where e.voided_at is null and (e.downtime_type = 'Unplanned Breakdown' or (e.downtime_type = 'Condition-Based Maintenance (CBM)' and e.immediate_stop)) and a.area = any (s.areas)
                            and e.start_at < s.w1 and coalesce(e.end_at, now()) > s.w0), 0)) as down
      from sess s where s.w0 < now() group by 1
  ),
  pm_from as (select public.pm_kpi_start() as d),
  pm as (   -- each PM period that ends inside the month (from the PM start date), carried out or not
    select mo.m0, count(*)::numeric as den, count(c.id)::numeric as num
      from months mo
      cross join my_areas ma
      cross join pm_from pf
      join public.pm_tasks k on k.active and k.area = any (ma.areas)
      cross join lateral (
        select distinct public.pm_period_start(k.frequency, d::date) as ps
          from generate_series(greatest(mo.m0 - 366, pf.d), mo.m1 - 1, interval '1 day') d
      ) per
      left join public.pm_completions c on c.task_id = k.id and c.period_start = per.ps and c.voided_at is null and c.result <> 'not_done'
     where pf.d < mo.m1 and mo.m1 <= public.lagos_now()::date + 1
       and per.ps >= pf.d
       and public.pm_period_end(k.frequency, per.ps) > mo.m0 and public.pm_period_end(k.frequency, per.ps) <= mo.m1
     group by mo.m0
  ),
  amc as (
    select mo.m0, count(*)::numeric as den,
           count(*) filter (where exists (select 1 from public.amc_visits v where v.contract_id = s.contract_id and v.month = s.month and v.voided_at is null))::numeric as num
      from months mo
      cross join my_areas ma
      join public.amc_schedule s on s.month = mo.m0 and s.planned
      join public.amc_contracts c on c.id = s.contract_id and c.active and (c.area is null or c.area = any (ma.areas))
     where mo.m0 <= public.lagos_now()::date
     group by mo.m0
  )
  select * from (
    select m0, kpi, num, den from q
    union all select m0, 'leakage', count(*) filter (where closed)::numeric, count(*)::numeric from leaks group by m0
    union all select m0, 'availability', den - down, den from avail where den > 0
    union all select m0, 'pm', num, den from pm
    union all select m0, 'amc', num, den from amc
  ) x where public.is_active_user() or auth.uid() is null   -- only approved accounts (or the server itself)
$$;
revoke execute on function public.engineer_kpi_auto(uuid, int) from public, anon;
