-- AMC "Past Due": a planned month ended with no visit recorded. Resolved when the visit is entered.
create or replace function public.run_amc_flags()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  this_month date := date_trunc('month', public.lagos_now())::date;
  n int;
begin
  with ins as (
    insert into public.flags (ref_key, kind, severity, area, amc_contract_id, title, detail, due_at)
    select 'amc:' || s.contract_id || ':' || s.month, 'amc_past_due', 'warning', c.area, c.id,
           format('AMC past due: %s (%s, %s)', c.description, c.vendor, to_char(s.month, 'Mon YYYY')),
           'The planned vendor visit has not been recorded.',
           public.lagos_ts((s.month + interval '1 month')::date, time '00:00')
      from public.amc_schedule s join public.amc_contracts c on c.id = s.contract_id
     where s.planned and c.active and s.month < this_month and s.month >= this_month - interval '12 months'
       and not exists (select 1 from public.amc_visits v
                        where v.contract_id = s.contract_id and v.month = s.month and v.voided_at is null)
    on conflict (ref_key) do nothing
    returning 1
  ) select count(*) into n from ins;

  update public.flags f set resolved_at = now(), resolution_note = 'AMC visit recorded'
   where f.kind = 'amc_past_due' and f.resolved_at is null
     and (exists (select 1 from public.amc_visits v
                   where v.contract_id = f.amc_contract_id and v.month = split_part(f.ref_key, ':', 3)::date
                     and v.voided_at is null)
          or not exists (select 1 from public.amc_schedule s
                          where s.contract_id = f.amc_contract_id and s.month = split_part(f.ref_key, ':', 3)::date
                            and s.planned));
  return n;
end;
$$;
revoke execute on function public.run_amc_flags() from public, anon, authenticated;

-- DEMO: plan this year's AMC visits, record most past ones; 4 weeks of cleaning checks with sign-offs.
create or replace function public.generate_amc_cleaning_demo(p_operator uuid, p_manager uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  y date := date_trunc('year', public.lagos_now())::date;
  this_month date := date_trunc('month', public.lagos_now())::date;
  wk date;
  n_plan int; n_visit int; n_clean int := 0;
begin
  if auth.uid() is not null and not public.has_role('admin') then
    raise exception 'Only an admin can generate demo data.' using errcode = 'P0001';
  end if;
  -- Trane & VAM monthly, softener monthly, air-conditioners quarterly
  insert into public.amc_schedule (contract_id, month, planned, updated_by)
  select c.id, m::date, true, p_manager
    from public.amc_contracts c, generate_series(y, y + interval '11 months', interval '1 month') m
   where c.sn in (1, 2, 3) or (c.sn = 4 and extract(month from m) in (1, 4, 7, 10))
  on conflict (contract_id, month) do nothing;
  get diagnostics n_plan = row_count;

  insert into public.amc_visits (contract_id, month, visit_date, vendor_rep, findings, recorded_by_type, recorded_by_id,
                                 recorded_at, reading_for, is_demo)
  select s.contract_id, s.month, s.month + 9, 'DEMO vendor engineer', 'DEMO: routine service completed, no major issues',
         'person', p_manager, public.lagos_ts(s.month + 9, time '15:00'), public.lagos_ts(s.month + 9, time '12:00'), true
    from public.amc_schedule s
   where s.planned and s.month < this_month and random() < 0.85
  on conflict do nothing;
  get diagnostics n_visit = row_count;

  for wk in select generate_series(public.pm_period_start('weekly', public.log_date_of(now())) - 28,
                                   public.pm_period_start('weekly', public.log_date_of(now())) - 7, interval '7 days')::date
  loop
    continue when exists (select 1 from public.cleaning_signoffs where week_start = wk);
    insert into public.cleaning_checks (week_start, zone_id, activity_id, result, note, recorded_by_type, recorded_by_id,
                                        recorded_at, reading_for, is_demo)
    select wk, z.id, a.id, case when r < 0.9 then 'done' else 'not_done' end,
           case when r >= 0.9 then 'DEMO: area occupied by contractors' end, 'person', p_operator,
           public.lagos_ts(wk + z.day_of_week, time '16:00'), public.lagos_ts(wk + z.day_of_week, time '16:00'), true
      from public.cleaning_zones z cross join public.cleaning_activities a cross join lateral (select random() + 0 * z.id + 0 * a.id as r) x
    on conflict do nothing;
    insert into public.cleaning_signoffs (week_start, signed_by, signed_at, comment, is_demo)
    values (wk, p_manager, public.lagos_ts(wk + 6, time '10:00'), 'DEMO sign-off', true)
    on conflict (week_start) do nothing;
    n_clean := n_clean + 15;
  end loop;
  return jsonb_build_object('planned', n_plan, 'visits', n_visit, 'cleaning_checks', n_clean);
end;
$$;
revoke execute on function public.generate_amc_cleaning_demo(uuid, uuid) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('chi-flag-job', '*/5 * * * *',
      'select public.run_pm_flags(); select public.run_amc_flags(); select public.run_flag_job()');
  end if;
end $$;
