-- PM flags: missed PM periods (from app_settings.pm_monitor_from) and "Done Not OK" follow-ups.

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
  -- 1. The previous period of each active task ended with nothing recorded
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

  -- resolve when the PM is entered late
  update public.flags f set resolved_at = now(), resolution_note = 'PM recorded (late)'
   where f.kind = 'pm_overdue' and f.resolved_at is null
     and exists (select 1 from public.pm_completions c
                  where c.task_id = f.pm_task_id and c.period_start = split_part(f.ref_key, ':', 3)::date
                    and c.voided_at is null);

  -- 2. Done Not OK → follow-up flag (resolved by an engineer on the Flags page)
  insert into public.flags (ref_key, kind, severity, area, asset_id, pm_task_id, title, detail, due_at, is_demo)
  select 'pmx:' || c.id, 'pm_followup', 'warning', t.area, t.asset_id, t.id,
         format('PM done, not OK: %s (%s)', t.equipment_as_written, replace(t.frequency, '_', '-')),
         c.note, c.recorded_at, c.is_demo
    from public.pm_completions c join public.pm_tasks t on t.id = c.task_id
   where c.result = 'done_not_ok' and c.voided_at is null and c.recorded_at > now() - interval '30 days'
  on conflict (ref_key) do nothing;

  return n;
end;
$$;
revoke execute on function public.run_pm_flags() from public, anon, authenticated;

-- DEMO PM results for the last p_days (daily), and current/previous periods for the rest.
create or replace function public.generate_pm_demo(p_days int, p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can generate demo data.' using errcode = 'P0001';
  end if;
  with periods as (
    select t.id as task_id, t.frequency, ps.p as period_start
      from public.pm_tasks t
      cross join lateral (
        select distinct public.pm_period_start(t.frequency, d::date) p
          from generate_series(public.log_date_of(now()) - p_days, public.log_date_of(now()) - 1, interval '1 day') d
      ) ps
     where t.active and (t.frequency in ('daily', 'weekly', 'monthly') or ps.p >= public.pm_period_start(t.frequency, public.log_date_of(now()) - 1))
  ), picked as (
    select p.*, random() r from periods p
  ), ins as (
    insert into public.pm_completions (task_id, period_start, result, note, recorded_by_type, recorded_by_id,
                                       recorded_at, reading_for, is_demo)
    select task_id, period_start,
           case when r < 0.04 then 'done_not_ok' when r < 0.10 then 'not_done' else 'done_ok' end,
           case when r < 0.04 then 'DEMO: leak found at gland, maintenance request raised'
                when r < 0.10 then 'DEMO: equipment running for production, rescheduled' end,
           'person', p_user,
           public.lagos_ts(least(public.pm_period_end(frequency, period_start) - 1, public.log_date_of(now())), time '10:00'),
           public.lagos_ts(least(public.pm_period_end(frequency, period_start) - 1, public.log_date_of(now())), time '10:00'),
           true
      from picked
     where r < 0.93   -- ~7% left blank (missed)
    on conflict do nothing
    returning 1
  ) select count(*) into n from ins;
  return n;
end;
$$;
revoke execute on function public.generate_pm_demo(int, uuid) from public, anon, authenticated;

-- run PM flags just before the main job (so escalation covers them)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *', 'select public.run_pm_flags(); select public.run_flag_job()');
  end if;
end $$;
