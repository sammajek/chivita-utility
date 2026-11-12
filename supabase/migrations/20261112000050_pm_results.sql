-- PM results renamed and extended (owner, 2026-11-12). Stored codes stay the same so history and reports keep working:
--   done_ok     "Completed – no issue found"   (√)
--   done_not_ok "Completed – issue found"      (X, opens a follow-up as before)
--   pending     "Pending"                      (P, new: must give the date it will be done by)
--   not_done    "Skipped"                      (--, reason required)
-- A pending PM is finished later with resolve_pending_pm (the pending entry is kept, voided as "completed after pending").
-- Pending past its date raises a PM overdue flag. Only √ and X count as carried out in KPIs and reports.

alter table public.pm_completions drop constraint if exists pm_completions_result_check;
alter table public.pm_completions drop constraint if exists pm_completions_check;
alter table public.pm_completions add column if not exists pending_until date;
alter table public.pm_completions add constraint pm_completions_result_check check (result in ('done_ok', 'done_not_ok', 'pending', 'not_done'));
alter table public.pm_completions add constraint pm_completions_note_check check (result in ('done_ok', 'pending') or coalesce(trim(note), '') <> '');
alter table public.pm_completions add constraint pm_completions_pending_check
  check ((result = 'pending') = (pending_until is not null) and (pending_until is null or pending_until >= period_start));

create or replace function public.resolve_pending_pm(p_id uuid, p_result text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare c public.pm_completions; v uuid;
begin
  if not public.has_role('operator', 'engineer', 'shift_manager', 'section_manager', 'admin') then
    raise exception 'Your role cannot record PM.' using errcode = 'P0001';
  end if;
  select * into c from pm_completions where id = p_id and voided_at is null;
  if c.id is null or c.result <> 'pending' then raise exception 'This PM is not pending any more. Refresh the page.' using errcode = 'P0001'; end if;
  if p_result not in ('done_ok', 'done_not_ok', 'not_done') then raise exception 'Choose the final result.' using errcode = 'P0001'; end if;
  if p_result <> 'done_ok' and coalesce(length(trim(p_note)), 0) < 3 then
    raise exception 'Add a note for "Completed – issue found" or "Skipped".' using errcode = 'P0001';
  end if;
  perform public.set_change_reason('Completed after pending');
  update pm_completions set voided_at = now(), voided_by = auth.uid(), void_reason = 'Completed after pending' where id = p_id;
  insert into pm_completions (task_id, period_start, result, note, recorded_by_type)
  values (c.task_id, c.period_start, p_result, nullif(trim(p_note), ''), 'person') returning id into v;
  update flags set resolved_at = now(), resolution_note = 'PM completed' where ref_key = 'pmp:' || p_id and resolved_at is null;
  return v;
end;
$$;
revoke execute on function public.resolve_pending_pm(uuid, text, text) from public, anon;

create or replace function public.run_pm_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  monitor_from date := (select (value #>> '{}')::date from public.app_settings where key = 'pm_monitor_from');
  today date := public.log_date_of(now());
  n int := 0;
begin
  if monitor_from is not null then
    with prev as (
      select t.*, public.pm_period_start(t.frequency, public.pm_period_start(t.frequency, today) - 1) as p_start
        from public.pm_tasks t where t.active
    ), ins as (
      insert into public.flags (ref_key, kind, severity, area, asset_id, pm_task_id, title, detail, due_at)
      select 'pm:' || p.id || ':' || p.p_start, 'pm_overdue', 'warning', p.area, p.asset_id, p.id,
             format('PM not recorded: %s (%s, %s)', p.equipment_as_written, replace(p.frequency, '_', '-'),
                    to_char(p.p_start, 'DD Mon')),
             array_to_string(p.tasks, E'\n'),
             public.lagos_ts(public.pm_period_end(p.frequency, p.p_start), time '07:00')
        from prev p
       where p.p_start >= monitor_from
         and not exists (select 1 from public.pm_completions c
                          where c.task_id = p.id and c.period_start = p.p_start and c.voided_at is null)
      on conflict (ref_key) do nothing
      returning 1
    ) select count(*) into n from ins;
  end if;

  update public.flags f set resolved_at = now(), resolution_note = 'PM recorded (late)'
   where f.kind = 'pm_overdue' and f.resolved_at is null and f.ref_key like 'pm:%'
     and exists (select 1 from public.pm_completions c
                  where c.task_id = f.pm_task_id and c.period_start = split_part(f.ref_key, ':', 3)::date
                    and c.voided_at is null);

  -- Pending past its promised date
  insert into public.flags (ref_key, kind, severity, area, asset_id, pm_task_id, title, detail, due_at, is_demo)
  select 'pmp:' || c.id, 'pm_overdue', 'warning', t.area, t.asset_id, t.id,
         format('PM pending past %s: %s (%s)', to_char(c.pending_until, 'DD Mon'), t.equipment_as_written, replace(t.frequency, '_', '-')),
         c.note, public.lagos_ts(c.pending_until + 1, time '07:00'), c.is_demo
    from public.pm_completions c join public.pm_tasks t on t.id = c.task_id
   where c.result = 'pending' and c.voided_at is null and c.pending_until < today
  on conflict (ref_key) do nothing;

  insert into public.flags (ref_key, kind, severity, area, asset_id, pm_task_id, title, detail, due_at, is_demo)
  select 'pmx:' || c.id, 'pm_followup', 'warning', t.area, t.asset_id, t.id,
         format('PM completed, issue found: %s (%s)', t.equipment_as_written, replace(t.frequency, '_', '-')),
         c.note, c.recorded_at, c.is_demo
    from public.pm_completions c join public.pm_tasks t on t.id = c.task_id
   where c.result = 'done_not_ok' and c.voided_at is null and c.recorded_at > now() - interval '30 days'
  on conflict (ref_key) do nothing;

  return n;
end;
$$;
revoke execute on function public.run_pm_flags() from public, anon, authenticated;

create or replace function public.affirm_pm_period(p_freq text, p_area public.area_code, p_period date, p_note text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  ps date := public.pm_period_start(p_freq, p_period);
  t int; ok int; nok int; nd int; nr int;
  new_id uuid;
begin
  if not public.is_engineer_or_above() then
    raise exception 'Only engineers and managers can affirm PM.' using errcode = 'P0001';
  end if;
  if ps > public.log_date_of(now()) then
    raise exception 'You cannot affirm a future period.' using errcode = 'P0001';
  end if;
  select count(*), count(*) filter (where c.result = 'done_ok'), count(*) filter (where c.result = 'done_not_ok'),
         count(*) filter (where c.result in ('not_done', 'pending')), count(*) filter (where c.id is null)
    into t, ok, nok, nd, nr
    from public.pm_tasks k
    left join public.pm_completions c on c.task_id = k.id and c.period_start = ps and c.voided_at is null
   where k.active and k.frequency = p_freq and k.area = p_area;
  if t = 0 then raise exception 'No PM tasks for this frequency and area.' using errcode = 'P0001'; end if;
  if (nr > 0 or nd > 0 or nok > 0) and coalesce(length(trim(p_note)), 0) < 5 then
    raise exception 'Some PMs are pending, skipped, have an issue or are not recorded: add a note (5+ characters) before affirming.' using errcode = 'P0001';
  end if;
  insert into public.pm_affirmations (frequency, area, period_start, total_tasks, done_ok, done_not_ok, not_done, not_recorded,
                                      note, recorded_by_type, reading_for)
  values (p_freq, p_area, ps, t, ok, nok, nd, nr, nullif(trim(p_note), ''), 'person', now())
  returning id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'This period is already affirmed.' using errcode = 'P0001';
end;
$$;
revoke execute on function public.affirm_pm_period(text, public.area_code, date, text) from public, anon;

create or replace function public.report_pm_summary(p_from date, p_to date, p_area public.area_code default null)
returns table (frequency text, tasks bigint, due bigint, done_ok bigint, done_not_ok bigint, not_done bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with pf as (select greatest(public.pm_kpi_start(), p_from - 366) as d),
  per as (
    select k.id, k.frequency, x.ps
      from public.pm_tasks k cross join pf
      cross join lateral (select distinct public.pm_period_start(k.frequency, d::date) as ps
                            from generate_series(greatest(p_from - 366, pf.d), p_to, interval '1 day') d) x
     where k.active and (p_area is null or k.area = p_area)
       and x.ps >= public.pm_kpi_start()
       and public.pm_period_end(k.frequency, x.ps) > p_from and public.pm_period_end(k.frequency, x.ps) <= p_to + 1
  )
  select per.frequency, count(distinct per.id), count(*),
         count(c.id) filter (where c.result = 'done_ok'), count(c.id) filter (where c.result = 'done_not_ok'),
         count(c.id) filter (where c.result in ('not_done', 'pending'))
    from per left join public.pm_completions c on c.task_id = per.id and c.period_start = per.ps and c.voided_at is null
   group by per.frequency
   order by array_position(array['daily', 'weekly', 'monthly', 'quarterly', 'bi_annual', 'annual'], per.frequency)
$$;

-- Engineer KPI: PM carried out = completed (√ or X) only, not pending.
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
