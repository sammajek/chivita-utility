-- Operations: downtime RCA rule, duty check-in/out, flag job and escalation.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'eng3@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'shiftmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000d3', 'op3@test.local');
update public.profiles set role = 'engineer', active = true where email = 'eng3@test.local';
update public.profiles set role = 'shift_manager', active = true where email = 'shiftmgr@test.local';
update public.profiles set role = 'operator', active = true where email = 'op3@test.local';

-- Time helpers
do $$ begin
  assert public.log_date_of('2026-10-10 03:00+01') = '2026-10-09', '03:00 belongs to the previous log date';
  assert public.log_date_of('2026-10-10 07:00+01') = '2026-10-10', '07:00 starts a new log date';
  assert public.slot_due('time', '2026-10-09', '03:00') = '2026-10-10 03:00+01', '03:00 slot is next calendar day';
  assert public.slot_due('shift', '2026-10-09', 'night') = '2026-10-10 07:00+01', 'night shift due at 07:00 next day';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d3', true);

do $$
declare b uuid := (select id from public.assets where code = 'BLR-03'); e public.downtime_events;
begin
  -- 5-hour breakdown → RCA required
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status)
  values (b, 'night', 'Unplanned Breakdown', 'Instrumentation and Control', 'Level control fault',
          '2026-08-04 22:15+01', '2026-08-05 03:30+01', 'Closed') returning * into e;
  assert e.rca_required, 'downtime ≥ 4 h needs RCA';
  assert public.downtime_hours(e) = 5.25, 'hours across midnight = 5.25';
  assert e.event_no like 'DT-%', 'event number assigned';

  -- short events: third repeat of same failure mode → RCA required
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status)
  values (b, 'day', 'Unplanned Breakdown', 'Mechanical', 'Bearing failure', '2026-09-01 09:00+01', '2026-09-01 10:00+01', 'Closed') returning * into e;
  assert not e.rca_required, 'first short event: no RCA';
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status)
  values (b, 'day', 'Unplanned Breakdown', 'Mechanical', 'Bearing failure', '2026-09-05 09:00+01', '2026-09-05 10:00+01', 'Closed');
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status)
  values (b, 'day', 'Unplanned Breakdown', 'Mechanical', 'Bearing failure', '2026-09-09 09:00+01', '2026-09-09 10:00+01', 'Closed') returning * into e;
  assert e.rca_required and e.rca_reason like '3 repeats%', 'third repeat needs RCA';

  -- invalid pick-list combination rejected
  begin
    insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, status)
    values (b, 'day', 'Unplanned Breakdown', 'Mechanical', 'Overload trip', now(), 'Open');
    raise exception 'wrong category should fail';
  exception when sqlstate 'P0001' then null;
  end;

  -- override hours need a reason
  begin
    insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, override_hours, status)
    values (b, 'day', 'Planned Maintenance', 'Planned Maintenance', 'Major overhaul', now() - interval '2 hours', now(), 8, 'Closed');
    raise exception 'override without reason should fail';
  exception when check_violation then null;
  end;

  -- operator cannot create an RCA
  begin
    insert into public.rcas (asset_id, problem) values (b, 'x');
    raise exception 'operator RCA should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Engineer: check in, RCA, flags
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
declare s public.duty_sessions; x public.rcas;
begin
  s := public.check_in('{U1}');
  assert s.profile_id = auth.uid() and s.checked_out_at is null, 'checked in';
  begin
    perform public.check_out('ok');
    raise exception 'short handover should fail';
  exception when sqlstate 'P0001' then null;
  end;

  insert into public.rcas (asset_id, problem, status, category_6m, target_date)
  values ((select id from public.assets where code = 'BLR-03'), 'Repeat bearing failure', 'Investigation Ongoing',
          'Machine (equipment / design)', current_date - 3) returning * into x;
  assert x.rca_no like 'RCA-%', 'RCA number assigned';
end $$;

reset role;

-- Flag job: monitored register with no readings yesterday → missing flags; RCA overdue flag.
update public.registers set monitor = true where key = 'u1-boiler';
do $$
declare res jsonb; n int;
begin
  res := public.run_flag_job();
  select count(*) into n from public.flags where kind = 'reading_missing';
  assert n > 0, 'missing-reading flags raised for monitored register';
  assert not exists (select 1 from public.flags f join public.registers r on r.id = f.register_id
                      where f.kind = 'reading_missing' and r.key <> 'u1-boiler'), 'only monitored registers flagged';
  assert exists (select 1 from public.flags where kind = 'rca_overdue'), 'overdue RCA flagged';

  -- running twice does not duplicate
  perform public.run_flag_job();
  assert (select count(*) from public.flags where kind = 'reading_missing') = n, 'idempotent';

  -- escalate: pretend flags were raised an hour ago
  update public.flags set raised_at = now() - interval '60 minutes', escalation_level = 0, last_escalated_at = null;
  perform public.run_flag_job();
  assert exists (select 1 from public.flags where escalation_level = 2), 'escalated to shift manager after 45 min';
  assert exists (select 1 from public.notifications n join public.profiles p on p.id = n.recipient_id
                  where p.email = 'shiftmgr@test.local' and n.kind = 'escalation' and n.status = 'queued'),
         'batched email queued for shift manager';
  assert (select count(*) from public.notifications n join public.profiles p on p.id = n.recipient_id
           where p.email = 'shiftmgr@test.local') = 1, 'one message per recipient per run';
end $$;

-- Readings entered late resolve the missing flag.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
declare f public.flags; fld uuid; sec uuid;
begin
  select * into f from public.flags where kind = 'reading_missing' order by due_at limit 1;
  sec := split_part(f.ref_key, ':', 2)::uuid;
  select id into fld from public.register_fields where section_id = sec and label like 'Steam Pressure%';
  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
  values (fld, (select id from public.assets where code = 'BLR-01'), split_part(f.ref_key, ':', 3)::date,
          substring(f.ref_key from '^miss:[^:]+:[^:]+:(.*)$'), f.due_at, 8.2);
end $$;
reset role;
do $$
declare fid uuid;
begin
  select id into fid from public.flags where kind = 'reading_missing' order by due_at limit 1;
  perform public.run_flag_job();
  assert (select resolved_at is not null from public.flags where id = fid), 'late reading resolves missing flag';
end $$;

-- Check-out acknowledges open flags in the person's areas.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
declare s public.duty_sessions;
begin
  s := public.check_out('Boiler 1 steam pressure low at 15:00, monitoring. No other issues.');
  assert s.checked_out_at is not null and s.open_flags_at_checkout >= 0, 'checked out with handover';
  assert not exists (select 1 from public.flags where resolved_at is null and area = 'U1' and acknowledged_at is null), 'U1 flags acknowledged';
end $$;

rollback;
