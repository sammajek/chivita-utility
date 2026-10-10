-- Preventive maintenance: periods, completion codes, voiding, flags.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'pmop@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'pmeng@test.local');
update public.profiles set role = 'operator', active = true where email = 'pmop@test.local';
update public.profiles set role = 'engineer', active = true where email = 'pmeng@test.local';

do $$
begin
  assert (select count(*) from public.pm_tasks) = 277, 'all 277 PM rows loaded';
  assert (select count(*) from public.pm_tasks where asset_id is not null) > 230, 'most PM rows mapped to assets';
  assert public.pm_period_start('weekly', '2026-10-10') = '2026-10-04', 'week starts Sunday';
  assert public.pm_period_start('quarterly', '2026-11-20') = '2026-10-01', 'quarter start';
  assert public.pm_period_start('bi_annual', '2026-10-10') = '2026-07-01', 'half-year start';
  assert public.pm_period_end('monthly', '2026-01-01') = '2026-02-01', 'month end';
  assert (select hours_interval from public.pm_tasks where hours_interval = 8000 limit 1) = 8000, 'running-hours tasks detected';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$
declare t uuid := (select id from public.pm_tasks where frequency = 'weekly' and equipment_as_written = 'STEAM BOILER 1');
        c public.pm_completions;
begin
  insert into public.pm_completions (task_id, period_start, result) values (t, public.log_date_of(now()), 'done_ok')
  returning * into c;
  assert c.period_start = public.pm_period_start('weekly', public.log_date_of(now())), 'period snapped to week start';
  assert c.recorded_by_id = auth.uid(), 'tagged to the person';

  begin
    insert into public.pm_completions (task_id, result) values (t, 'done_ok');
    raise exception 'second result in same period should fail';
  exception when unique_violation then null;
  end;

  begin
    insert into public.pm_completions (task_id, result)
    values ((select id from public.pm_tasks where frequency = 'daily' and equipment_as_written = 'STEAM BOILER 2'), 'not_done');
    raise exception 'not done without a note should fail';
  exception when check_violation then null;
  end;

  begin
    insert into public.pm_completions (task_id, period_start, result) values (t, public.log_date_of(now()) + 14, 'done_ok');
    raise exception 'future period should fail';
  exception when sqlstate 'P0001' then null;
  end;

  insert into public.pm_completions (task_id, result, note)
  values ((select id from public.pm_tasks where frequency = 'daily' and equipment_as_written = 'STEAM BOILER 3'),
          'done_not_ok', 'Blowdown valve passing');

  begin
    update public.pm_completions set result = 'done_not_ok', note = 'x' where id = c.id;
    raise exception 'direct change should fail';
  exception when sqlstate 'P0001' then null;
  end;

  perform public.void_pm_completion(c.id, 'Entered against the wrong boiler');
  assert (select voided_at is not null from public.pm_completions where id = c.id), 'voided';
  insert into public.pm_completions (task_id, result) values (t, 'done_ok');  -- can re-enter after void
end $$;
reset role;

do $$
declare n int;
begin
  assert exists (select 1 from public.audit_log where table_name = 'pm_completions' and reason = 'Entered against the wrong boiler'),
         'void reason in audit log';

  -- flags off until go-live date is set
  perform public.run_pm_flags();
  assert not exists (select 1 from public.flags where kind = 'pm_overdue'), 'no PM flags before go-live';
  assert exists (select 1 from public.flags where kind = 'pm_followup'), 'done-not-ok opens a follow-up';

  update public.app_settings set value = to_jsonb((public.log_date_of(now()) - 400)::text) where key = 'pm_monitor_from';
  n := public.run_pm_flags();
  assert n > 0, 'missed previous periods flagged';
  assert exists (select 1 from public.flags where kind = 'pm_overdue' and title like '%STEAM BOILER 1 (daily%'), 'daily PM flagged';
  perform public.run_pm_flags();
  assert (select count(*) from public.flags where kind = 'pm_overdue') = n, 'idempotent';
end $$;

-- late entry resolves the flag
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
insert into public.pm_completions (task_id, period_start, result)
select id, public.log_date_of(now()) - 1, 'done_ok' from public.pm_tasks where frequency = 'daily' and equipment_as_written = 'STEAM BOILER 1';
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  perform public.run_pm_flags();
  assert (select resolved_at is not null from public.flags
           where kind = 'pm_overdue' and title like '%STEAM BOILER 1 (daily%'), 'late PM resolves flag';
  assert public.generate_pm_demo(7, '00000000-0000-0000-0000-0000000000e1') > 100, 'demo PM generated';
  perform public.clear_pm_demo();
  assert not exists (select 1 from public.pm_completions where is_demo), 'demo PM cleared';
end $$;
rollback;
