-- Running-hours cross-check, worked example on Air Compressor 4 (CMP-04):
--   counter 5000 h, then 4990 h (went down) → "counter" flag; no last service known → "baseline" flag;
--   the 4000 h service PM recorded done → 4000 h (and smaller) intervals restart at 4990 h;
--   a 16000 h service entered at 9000 h (counter 4990 h) → "service" flag; baselines now all known → "baseline" flag resolved.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'hrsx@test.local');
update public.profiles set role = 'engineer', active = true where email = 'hrsx@test.local';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
do $$
declare cmp uuid := (select id from public.assets where code = 'CMP-04'); f public.register_fields; v numeric := 5000; rs record;
begin
  select rf.* into f from public.register_fields rf join public.parameters p on p.id = rf.parameter_id
    join public.register_sections s on s.id = rf.section_id join public.register_assets ra on ra.register_id = s.register_id
   where p.name = 'Running Hours' and p.is_counter and ra.asset_id = cmp and rf.asset_id is null limit 1;
  assert f.id is not null, 'running hours field for CMP-04';
  for rs in select d::date as log_date, x.slot_key, x.due_at
              from generate_series(public.log_date_of(now()) - 2, public.log_date_of(now()), interval '1 day') d,
                   lateral public.register_slots(d::date) x
             where x.section_id = f.section_id and x.due_at < now() - interval '30 minutes'
             order by x.due_at desc limit 2
  loop
    -- newest slot first: 4990 h (latest), then the older slot 5000 h
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
    values (f.id, cmp, rs.log_date, rs.slot_key, rs.due_at, case when v = 5000 then 4990 else 5000 end);
    v := 0;
  end loop;
  assert (select hours from public.asset_running_hours(cmp)) = 4990, 'latest counter 4990 h';
end $$;

reset role;
do $$
declare cmp uuid := (select id from public.assets where code = 'CMP-04');
begin
  perform public.run_hours_crosscheck();
  assert exists (select 1 from public.flags where kind = 'hours_check' and asset_id = cmp and ref_key like '%:baseline' and resolved_at is null), 'baseline flag';
  assert exists (select 1 from public.flags where kind = 'hours_check' and asset_id = cmp and ref_key like '%:counter:%' and title like '%went down%'), 'counter went down flag';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
  assert (select count(*) from public.running_hours_overview() where code = 'CMP-04' and status = 'no_baseline' and hours = 4990) = 4,
         'overview: 4 intervals waiting for a baseline at 4990 h';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c9', true);
do $$
declare cmp uuid := (select id from public.assets where code = 'CMP-04'); t uuid;
begin
  select id into t from public.pm_tasks where asset_id = cmp and hours_interval = 4000 and active limit 1;
  assert t is not null, '4000 h PM task for CMP-04';
  insert into public.pm_completions (task_id, period_start, result) values (t, public.log_date_of(now()), 'done_ok');
  assert (select last_service_hours from public.service_intervals where asset_id = cmp and interval_hours = 4000) = 4990, 'PM restarts 4000 h clock at the counter';
  assert (select last_service_hours from public.service_intervals where asset_id = cmp and interval_hours = 2000) = 4990, 'and the 2000 h clock';
  assert (select last_service_hours from public.service_intervals where asset_id = cmp and interval_hours = 8000) is null, '8000 h not touched';
  perform public.record_service((select id from public.service_intervals where asset_id = cmp and interval_hours = 16000), 9000, public.lagos_now()::date, 'typo test');
end $$;

reset role;
do $$
declare cmp uuid := (select id from public.assets where code = 'CMP-04');
begin
  perform public.run_hours_crosscheck();
  assert exists (select 1 from public.flags where kind = 'hours_check' and asset_id = cmp and ref_key like '%:service:%' and resolved_at is null), 'service above counter flagged';
  assert exists (select 1 from public.flags where kind = 'hours_check' and asset_id = cmp and ref_key like '%:baseline' and resolved_at is not null), 'baseline flag resolved';
end $$;
rollback;
