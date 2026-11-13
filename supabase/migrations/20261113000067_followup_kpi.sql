-- Maintenance KPIs (owner, 2026-11-13): PM completion (already on the tracker) plus follow-ups.
--  * KPI "Follow-ups Closed on Time %": follow-ups due in the month, in my areas, closed by their due date ÷ follow-ups due
--    (only counted once due, or once closed). A follow-up is
--      - a downtime "further action" (due = its target date; closed = marked complete, or the event resolved), or
--      - a PM done "X" (issue found) (due = recorded + pm_followup_days, default 7; closed = its flag resolved).
--  * open_followups(): the live list of open follow-ups for the KPI page.
--  * kpi_definitions.shift_based marks KPIs that need checked-in shifts (n/a for office-hours staff).

alter table public.kpi_definitions add column if not exists shift_based boolean not null default false;
update public.kpi_definitions set shift_based = true where code in ('availability', 'cw_temp', 'water_quality', 'dew_point', 'leakage');
do $$
begin
  if not exists (select 1 from public.kpi_definitions where code = 'followup') then
    update public.kpi_definitions set sort = sort + 1 where sort >= 6;
    insert into public.kpi_definitions (code, name, category, target_text, target_min, source, formula, sort) values
      ('followup', 'Follow-ups Closed on Time %', 'Maintenance', '≥90%', 90, 'auto',
       'Follow-ups due in the month in my areas closed by their due date ÷ follow-ups due. Follow-ups = downtime further actions (target date) and PM tasks done with an issue (X), due 7 days after recording', 6);
  end if;
end $$;

insert into public.app_settings (key, value, description) values
  ('pm_followup_days', '7', 'Days allowed to close a PM issue (task done with X) before it counts as late')
on conflict (key) do nothing;

-- All follow-ups (open and closed) with due date and closing time.
create or replace function public.followup_items(p_areas public.area_code[])
returns table (kind text, ref_id uuid, ref text, asset_code text, title text, owner text, due date, closed_at timestamptz, area public.area_code)
language sql
stable
security definer
set search_path = public
as $$
  select 'downtime', e.id, e.event_no, a.code, f.note, f.action_owner, f.target_date,
         coalesce(f.completed_at,
                  (select min(r.recorded_at) from downtime_followups r
                    where r.downtime_id = e.id and r.stage = 'resolved' and r.voided_at is null and r.recorded_at >= f.recorded_at)),
         a.area
    from downtime_followups f
    join downtime_events e on e.id = f.downtime_id and e.voided_at is null and not e.is_demo
    join assets a on a.id = e.asset_id
   where f.stage = 'further_action' and f.voided_at is null and not f.is_demo and a.area = any (p_areas)
     and (public.is_active_user() or auth.uid() is null)
  union all
  select 'pm', c.id, initcap(replace(t.frequency, '_', '-')) || ' PM', a.code, coalesce(t.equipment_as_written, '') || coalesce(': ' || c.note, ''),
         p.full_name, ((c.recorded_at at time zone 'Africa/Lagos')::date + public.setting_num('pm_followup_days', 7)::int),
         (select fl.resolved_at from flags fl where fl.ref_key = 'pmx:' || c.id),
         coalesce(t.area, a.area)
    from pm_completions c
    join pm_tasks t on t.id = c.task_id
    left join assets a on a.id = t.asset_id
    left join profiles p on p.id = c.recorded_by_id
   where c.result = 'done_not_ok' and c.voided_at is null and not c.is_demo and coalesce(t.area, a.area) = any (p_areas)
     and (public.is_active_user() or auth.uid() is null)
$$;
revoke execute on function public.followup_items(public.area_code[]) from public, anon;

-- Open follow-ups for the KPI page (my areas by default).
create or replace function public.open_followups(p_profile uuid default null)
returns table (kind text, ref_id uuid, ref text, asset_code text, title text, owner text, due date, overdue boolean, area public.area_code)
language sql
stable
security definer
set search_path = public
as $$
  select i.kind, i.ref_id, i.ref, i.asset_code, i.title, i.owner, i.due, i.due < public.lagos_now()::date, i.area
    from public.followup_items(coalesce((select areas from profiles where id = coalesce(p_profile, auth.uid())), '{U1,U2}')) i
   where i.closed_at is null and public.is_active_user()
   order by i.due, i.ref
$$;
revoke execute on function public.open_followups(uuid) from public, anon;

-- Engineer KPI tracker: as before, plus 'followup'.
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
  sess as (
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
  pm as (
    select mo.m0, count(*)::numeric as den, count(c.id)::numeric as num
      from months mo
      cross join my_areas ma
      cross join pm_from pf
      join public.pm_tasks k on k.active and k.area = any (ma.areas)
      cross join lateral (
        select distinct public.pm_period_start(k.frequency, d::date) as ps
          from generate_series(greatest(mo.m0 - 366, pf.d), mo.m1 - 1, interval '1 day') d
      ) per
      left join public.pm_completions c on c.task_id = k.id and c.period_start = per.ps and c.voided_at is null and c.result in ('done_ok', 'done_not_ok')
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
  ),
  fu as (
    select date_trunc('month', i.due)::date as m0,
           count(*) filter (where i.closed_at is not null and (i.closed_at at time zone 'Africa/Lagos')::date <= i.due)::numeric as num,
           count(*)::numeric as den
      from my_areas ma cross join lateral public.followup_items(ma.areas) i
     where extract(year from i.due) = p_year and (i.due < public.lagos_now()::date or i.closed_at is not null)
     group by 1
  )
  select * from (
    select m0, kpi, num, den from q
    union all select m0, 'leakage', count(*) filter (where closed)::numeric, count(*)::numeric from leaks group by m0
    union all select m0, 'availability', den - down, den from avail where den > 0
    union all select m0, 'pm', num, den from pm
    union all select m0, 'amc', num, den from amc
    union all select m0, 'followup', num, den from fu
  ) x where public.is_active_user() or auth.uid() is null
$$;
