-- Downtime follow-up, equipment state sync, PM affirmation, running-hours service flags.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'fuop@test.local'),
  ('00000000-0000-0000-0000-0000000000d2', 'fueng@test.local');
update public.profiles set role = 'operator', active = true where email = 'fuop@test.local';
update public.profiles set role = 'engineer', active = true where email = 'fueng@test.local';
create temp table t_ids (k text primary key, id uuid);
grant all on t_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);
do $$
declare e public.downtime_events; a public.assets; f uuid;
begin
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, status, attended_by)
  values ((select id from public.assets where code = 'CMP-04'), 'day', 'Unplanned Breakdown', 'Mechanical',
          (select value from public.lists where list_name = 'failure_mode' and parent = 'Mechanical' limit 1),
          now() - interval '2 hours', 'Open', 'Utility Section (In-house); Electrical & Instrumentation Section; Other: Kitchen')
  returning * into e;
  insert into t_ids values ('dt', e.id);
  select * into a from public.assets where code = 'CMP-04';
  assert a.op_state = 'unavailable' and a.op_reason = 'Breakdown', 'open breakdown makes the machine unavailable';
  assert e.asset_id not in (select asset_id from public.slot_expected_assets(
           (select s.id from public.register_sections s join public.register_fields rf on rf.section_id = s.id
             where rf.asset_id is null limit 1), now())), 'unavailable machine not expected to log';

  insert into public.downtime_followups (downtime_id, stage, note) values (e.id, 'containment', 'Bypassed the faulty valve');
  assert (select followup_stage from public.downtime_events where id = e.id) = 'containment', 'stage tracked';

  begin
    insert into public.downtime_followups (downtime_id, stage, note) values (e.id, 'further_action', 'Replace valve');
    raise exception 'further action without owner/date should fail';
  exception when check_violation then null;
  end;
  insert into public.downtime_followups (downtime_id, stage, note, action_owner, target_date)
  values (e.id, 'further_action', 'Replace valve', 'E&I Section', public.lagos_now()::date - 1) returning id into f;
  insert into t_ids values ('fu', f);

  begin
    insert into public.downtime_followups (downtime_id, stage, note) values (e.id, 'resolved', 'All good');
    raise exception 'operator cannot resolve';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

reset role;
do $$
begin
  assert public.run_ops_flags() >= 1, 'overdue further action flagged';
  assert exists (select 1 from public.flags where kind = 'followup_overdue' and resolved_at is null), 'flag open';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
do $$
declare dt uuid := (select id from t_ids where k = 'dt');
begin
  begin
    insert into public.downtime_followups (downtime_id, stage, note) values (dt, 'resolved', 'All good');
    raise exception 'resolve before end time should fail';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.set_change_reason('Ended');
  update public.downtime_events set end_at = now() - interval '10 minutes' where id = dt;
  assert (select op_state from public.assets where code = 'CMP-04') = 'available', 'end time makes it available again';
  insert into public.downtime_followups (downtime_id, stage, note) values (dt, 'resolved', 'Valve replaced, tested 2 h');
  assert (select followup_stage from public.downtime_events where id = dt) = 'resolved', 'resolved';

  perform public.set_asset_state((select id from public.assets where code = 'CMP-05'), 'standby', null, 'Low demand');
  assert (select op_state from public.assets where code = 'CMP-05') = 'standby', 'manual standby';
  begin
    perform public.set_asset_state((select id from public.assets where code = 'CMP-05'), 'unavailable', null, null);
    raise exception 'unavailable without a reason should fail';
  exception when sqlstate 'P0001' then null;
  end;
  assert (select count(*) from public.asset_states where asset_id = (select id from public.assets where code = 'CMP-05')) = 1, 'one state row';

  -- PM affirmation: not-recorded tasks need a note
  begin
    perform public.affirm_pm_period('weekly', 'U1', public.log_date_of(now()), null);
    raise exception 'affirm with gaps and no note should fail';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.affirm_pm_period('weekly', 'U1', public.log_date_of(now()), 'Two PMs carried over to next week');
  assert (select not_recorded from public.pm_affirmations where frequency = 'weekly' and area = 'U1') > 0, 'counts frozen';
end $$;

reset role;
do $$
begin
  assert (select resolved_at from public.flags where kind = 'followup_overdue' limit 1) is null, 'still open until job runs';
  perform public.run_ops_flags();
  assert (select resolved_at from public.flags where kind = 'followup_overdue' limit 1) is not null, 'resolved event clears the flag';
  assert (select count(*) from public.service_intervals) >= 44, 'compressor service intervals seeded';
end $$;

-- running hours: baseline 2000 h, readings at 3850 h → 2000 h service due soon (warn 200 h); recording a 4000 h service resets ≤ 4000
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
do $$
declare cmp uuid := (select id from public.assets where code = 'CMP-03');
        si2 uuid := (select id from public.service_intervals where asset_id = (select id from public.assets where code = 'CMP-03') and interval_hours = 2000);
        si4 uuid := (select id from public.service_intervals where asset_id = (select id from public.assets where code = 'CMP-03') and interval_hours = 4000);
        f public.register_fields;
begin
  perform public.record_service(si2, 2000, public.lagos_now()::date - 60, 'baseline');
  select rf.* into f from public.register_fields rf join public.parameters p on p.id = rf.parameter_id
   join public.register_sections s on s.id = rf.section_id join public.register_assets ra on ra.register_id = s.register_id
   where p.name = 'Running Hours' and p.is_counter and ra.asset_id = cmp and rf.asset_id is null limit 1;
  assert f.id is not null, 'running hours field found for CMP-03';
  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
  select f.id, cmp, rs.log_date, rs.slot_key, rs.due_at, 3850
    from (select d::date as log_date, x.slot_key, x.due_at
            from generate_series(public.log_date_of(now()) - 1, public.log_date_of(now()), interval '1 day') d,
                 lateral public.register_slots(d::date) x
           where x.section_id = f.section_id and x.due_at < now() - interval '30 minutes'
           order by x.due_at desc limit 1) rs;
  assert (select hours from public.asset_running_hours(cmp)) = 3850, 'latest running hours';
  insert into t_ids values ('si2', si2), ('si4', si4);
end $$;

reset role;
do $$
declare si2 uuid := (select id from t_ids where k = 'si2'); si4 uuid := (select id from t_ids where k = 'si4');
begin
  perform public.run_ops_flags();
  assert exists (select 1 from public.flags where kind = 'hours_service_due' and service_interval_id = si2 and resolved_at is null), '2000 h service due soon';
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);
  perform public.record_service(si4, 3860, public.lagos_now()::date, '4000 h service done');
  assert (select last_service_hours from public.service_intervals where id = si2) = 3860, 'bigger service resets smaller interval';
  perform public.run_ops_flags();
  assert not exists (select 1 from public.flags where kind = 'hours_service_due' and service_interval_id = si2 and resolved_at is null), 'flag cleared';
end $$;
rollback;
