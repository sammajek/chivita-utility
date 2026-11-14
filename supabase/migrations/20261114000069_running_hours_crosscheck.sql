-- Running-hours PM cross-check (owner, 2026-11-14). Compressor services are due by calendar (quarterly / bi-annual /
-- annual PM) AND by running hours (2000 / 4000 / 8000 / 16000 h), whichever comes first. This keeps the two in step and
-- raises flags when the hours data cannot be trusted:
--  1. A PM of a running-hours task recorded done (√ or X) also records the service at the machine's running hours
--     (latest counter reading up to that moment), so the hours clock restarts. Bigger services reset smaller ones.
--  2. Flags (kind hours_check), one per machine and problem:
--     - baseline missing: the machine logs running hours but no last-service hours are known (due flags cannot work);
--     - counter went down, or rose faster than the clock (more hours than time passed between the two readings, +1 h);
--     - counter not logged for 7+ days (setting hours_stale_days) while the machine is not out of service;
--     - a service recorded at more hours than the counter showed.
--  3. running_hours_overview(): one row per machine and interval for the cross-check screen.

alter table public.flags drop constraint flags_kind_check;
alter table public.flags add constraint flags_kind_check check (kind in (
  'reading_missing', 'reading_early', 'out_of_spec', 'critical', 'no_checkin', 'downtime_open', 'rca_overdue',
  'pm_overdue', 'pm_followup', 'amc_past_due', 'water_alert', 'water_action', 'calibration_due',
  'followup_overdue', 'hours_service_due', 'training_unconfirmed', 'patrol_missed', 'patrol_issue',
  'handover_missing', 'handover_unack', 'pm_photo_missing', 'pm_spot_check', 'pm_early_failure', 'hours_check'));

insert into public.app_settings (key, value, description) values
  ('hours_stale_days', '7', 'Running-hours cross-check: flag a machine whose running hours have not been logged for this many days')
on conflict (key) do nothing;

-- All running-hours counter readings of a machine, oldest first, with the previous reading.
create or replace function public.running_hour_series(p_asset uuid)
returns table (hours numeric, read_at timestamptz, prev_hours numeric, prev_at timestamptz, taken_at timestamptz, prev_taken_at timestamptz)
language sql
stable
set search_path = public
as $$
  -- read_at = the slot the reading belongs to; taken_at = when the counter was actually read
  -- (entry time for people, the logger's own timestamp for loggers)
  select x.hours, x.read_at, lag(x.hours) over w, lag(x.read_at) over w, x.taken_at, lag(x.taken_at) over w
    from (select r.value_num as hours, r.reading_for as read_at,
                 case when r.recorded_by_type = 'logger' then r.reading_for else r.recorded_at end as taken_at
            from readings r join parameters p on p.id = r.parameter_id
           where r.asset_id = p_asset and r.voided_at is null and r.value_num is not null and p.is_counter
             and p.name in ('Running Hours', 'Operating Hours', 'Compressor Running Time')) x
  window w as (order by x.read_at, x.taken_at)
$$;

-- 1. PM done for a running-hours task → service recorded at the counter.
create or replace function public.pm_completion_records_service()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare k public.pm_tasks; si public.service_intervals; h numeric;
begin
  if new.is_demo or new.voided_at is not null or new.result not in ('done_ok', 'done_not_ok') then return null; end if;
  if tg_op = 'UPDATE' and old.result in ('done_ok', 'done_not_ok') then return null; end if;
  select * into k from pm_tasks where id = new.task_id;
  if k.hours_interval is null or k.asset_id is null then return null; end if;
  select * into si from service_intervals where asset_id = k.asset_id and interval_hours = k.hours_interval and active;
  if si.id is null then return null; end if;
  select s.hours into h from running_hour_series(k.asset_id) s where s.read_at <= coalesce(new.reading_for, new.recorded_at)
   order by s.read_at desc limit 1;
  if h is null then return null; end if;   -- no counter yet: the baseline flag asks for it
  insert into service_records (interval_id, service_hours, serviced_on, note, recorded_by_type, recorded_by_id, reading_for)
  values (si.id, h, (new.recorded_at at time zone 'Africa/Lagos')::date,
          format('From PM record (%s): running hours %s at the last counter reading', replace(k.frequency, '_', '-'), round(h)),
          new.recorded_by_type, new.recorded_by_id, coalesce(new.reading_for, new.recorded_at));
  return null;
end;
$$;
revoke execute on function public.pm_completion_records_service() from public, anon, authenticated;
drop trigger if exists pm_completion_records_service on public.pm_completions;
create trigger pm_completion_records_service after insert or update of result on public.pm_completions
  for each row execute function public.pm_completion_records_service();

-- 3. Overview for the cross-check screen.
create or replace function public.running_hours_overview()
returns table (asset_id uuid, code text, name text, area public.area_code, op_state text,
               hours numeric, read_at timestamptz, interval_id uuid, interval_hours int, warn_before_hours int,
               last_service_hours numeric, last_service_on date, due_at_hours numeric, hours_left numeric, status text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.code, a.name, a.area, a.op_state::text, h.hours, h.read_at, si.id, si.interval_hours, si.warn_before_hours,
         si.last_service_hours, si.last_service_on,
         si.last_service_hours + si.interval_hours,
         si.last_service_hours + si.interval_hours - h.hours,
         case when h.hours is null then 'no_counter'
              when si.last_service_hours is null then 'no_baseline'
              when h.hours >= si.last_service_hours + si.interval_hours then 'overdue'
              when h.hours >= si.last_service_hours + si.interval_hours - si.warn_before_hours then 'due_soon'
              else 'ok' end
    from service_intervals si
    join assets a on a.id = si.asset_id and a.status <> 'retired'
    left join lateral public.asset_running_hours(a.id) h on true
   where si.active and public.is_active_user()
   order by a.code, si.interval_hours
$$;
revoke execute on function public.running_hours_overview() from public, anon;

-- 2. Cross-check flags (run every 5 minutes).
create or replace function public.run_hours_crosscheck()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int := 0; m int; stale int := public.setting_num('hours_stale_days', 7)::int;
begin
  with machines as (
    select distinct a.id, a.code, a.area, a.op_state::text as op_state from service_intervals si join assets a on a.id = si.asset_id
     where si.active and a.status <> 'retired'
  ),
  issues as (
    -- baseline missing (only once the machine logs running hours)
    select mc.id, mc.code, mc.area, 'baseline', 'warning',
           format('%s: enter the last service hours', mc.code),
           'Running hours are logged but no last service is known, so running-hours services cannot fall due. Enter it on PM → Running-Hours Cross-Check.'
      from machines mc
     where exists (select 1 from asset_running_hours(mc.id))
       and exists (select 1 from service_intervals si where si.asset_id = mc.id and si.active and si.last_service_hours is null)
    union all
    -- counter went down or rose faster than the clock (latest 30 days)
    select mc.id, mc.code, mc.area, 'counter:' || to_char(s.read_at at time zone 'Africa/Lagos', 'YYYYMMDDHH24MI'), 'warning',
           format('%s: running hours %s (%s → %s h)', mc.code,
                  case when s.hours < s.prev_hours then 'went down' else 'rose faster than the clock' end, round(s.prev_hours), round(s.hours)),
           format('Between %s and %s. Check the entry (correct it with a reason) or note a counter change.',
                  to_char(s.prev_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI'), to_char(s.read_at at time zone 'Africa/Lagos', 'DD Mon HH24:MI'))
      from machines mc cross join lateral running_hour_series(mc.id) s
     where s.prev_hours is not null and s.read_at > now() - interval '30 days'
       and (s.hours < s.prev_hours
            or s.hours - s.prev_hours > greatest(extract(epoch from (s.taken_at - s.prev_taken_at)), extract(epoch from (s.read_at - s.prev_at))) / 3600.0 + 1)
    union all
    -- not logged recently while in service
    select mc.id, mc.code, mc.area, 'stale', 'info',
           format('%s: running hours not logged for %s+ days', mc.code, stale),
           format('Last logged %s. Without it, running-hours services cannot be tracked.', to_char(h.read_at at time zone 'Africa/Lagos', 'DD Mon YYYY'))
      from machines mc cross join lateral asset_running_hours(mc.id) h
     where h.read_at < now() - make_interval(days => stale) and mc.op_state <> 'unavailable'
    union all
    -- service recorded at more hours than the counter showed at the time
    select mc.id, mc.code, mc.area, 'service:' || sr.id, 'warning',
           format('%s: service recorded at %s h, counter showed %s h', mc.code, round(sr.service_hours), round(c.hours)),
           'Check the hours entered for the service (void and re-enter it if wrong).'
      from machines mc
      join service_intervals si on si.asset_id = mc.id
      join service_records sr on sr.interval_id = si.id and sr.voided_at is null and not sr.is_demo and sr.recorded_at > now() - interval '30 days'
      cross join lateral (select s.hours from running_hour_series(mc.id) s where s.read_at <= coalesce(sr.reading_for, sr.recorded_at) + interval '1 day'
                           order by s.read_at desc limit 1) c
     where sr.service_hours > c.hours + 24
  )
  insert into flags (ref_key, kind, severity, area, asset_id, title, detail, due_at)
  select 'hrsx:' || i.code || ':' || i.k, 'hours_check', i.sev, i.area, i.id, i.title, i.detail, now()
    from issues i(id, code, area, k, sev, title, detail)
  on conflict (ref_key) do nothing;
  get diagnostics n = row_count;

  -- resolve flags whose problem is gone
  update flags fl set resolved_at = now(), resolution_note = 'Cross-check: fixed'
   where fl.kind = 'hours_check' and fl.resolved_at is null
     and ((split_part(fl.ref_key, ':', 3) = 'baseline'
           and not exists (select 1 from service_intervals si where si.asset_id = fl.asset_id and si.active and si.last_service_hours is null))
       or (split_part(fl.ref_key, ':', 3) = 'stale'
           and exists (select 1 from asset_running_hours(fl.asset_id) h
                        where h.read_at >= now() - make_interval(days => stale)))
       or (split_part(fl.ref_key, ':', 3) = 'service'
           and exists (select 1 from service_records sr where sr.id::text = split_part(fl.ref_key, ':', 4) and sr.voided_at is not null)));
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke execute on function public.run_hours_crosscheck() from public, anon, authenticated;

-- office-hours maintenance alerts also cover the cross-check flags
do $$
declare d text := pg_get_functiondef('public.run_office_alerts()'::regprocedure);
begin
  if position('''hours_check''' in d) = 0 then
    execute replace(d, '''hours_service_due'',', '''hours_service_due'', ''hours_check'',');
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_pm_verification_flags(); select public.run_pm_spot_checks(); select public.run_amc_flags(); select public.run_quality_flags(); select public.run_ops_flags(); select public.run_hours_crosscheck(); select public.run_training_flags(); select public.run_patrol_flags(); select public.run_handover_flags(); select public.run_deck_schedules(); select public.run_flag_job(); select public.run_office_alerts()');
  end if;
end $$;
