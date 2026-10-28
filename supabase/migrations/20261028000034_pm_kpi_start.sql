-- PM completion % counts PM periods from the PM go-live date (setting pm_monitor_from), or, until that is set,
-- from the first PM result ever recorded, so months before the PM log was used do not count as missed.
create or replace function public.pm_kpi_start()
returns date
language sql
stable
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::date from public.app_settings where key = 'pm_monitor_from'),
                  (select min(period_start) from public.pm_completions where voided_at is null),
                  'infinity'::date)
$$;

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
                          where e.voided_at is null and e.downtime_type = 'Unplanned Breakdown' and a.area = any (s.areas)
                            and e.start_at < s.w1 and coalesce(e.end_at, now()) > s.w0), 0)) as down
      from sess s where s.w0 < now() group by 1
  ),
  pm as (
    select mo.m0, count(*)::numeric as den, count(c.id)::numeric as num
      from months mo
      cross join my_areas ma
      join public.pm_tasks k on k.active and k.area = any (ma.areas)
      cross join lateral (
        select distinct public.pm_period_start(k.frequency, d::date) as ps
          from generate_series(mo.m0 - 366, mo.m1 - 1, interval '1 day') d
      ) per
      left join public.pm_completions c on c.task_id = k.id and c.period_start = per.ps and c.voided_at is null and c.result <> 'not_done'
     where public.pm_period_end(k.frequency, per.ps) > mo.m0 and public.pm_period_end(k.frequency, per.ps) <= mo.m1
       and mo.m1 <= public.lagos_now()::date + 1
       and per.ps >= public.pm_kpi_start()
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
