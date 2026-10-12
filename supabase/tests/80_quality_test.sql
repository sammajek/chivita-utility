-- Water quality results (alert/action) and calibration due dates.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'wqop@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'wqeng@test.local');
update public.profiles set role = 'operator', active = true where email = 'wqop@test.local';
update public.profiles set role = 'engineer', active = true where email = 'wqeng@test.local';

do $$
declare t public.water_tests;
begin
  assert (select count(*) from public.water_tests) = 112, '112 water tests loaded';
  select * into t from public.water_tests where sampling_point = 'Water from utility' and parameter = 'Total count';
  assert public.water_status(t, 20) = 'ok', 'below alert is ok';
  assert public.water_status(t, 75) = 'alert', '75 cfu ≥ alert 70';
  assert public.water_status(t, 100) = 'action', '100 is not < 100 → out of spec';
  select * into t from public.water_tests where sampling_point = 'Boiler Feed Water' and parameter = 'pH';
  assert public.water_status(t, 9.0) = 'ok' and public.water_status(t, 9.8) = 'action' and public.water_status(t, 8.2) = 'action', 'pH range';
  select * into t from public.water_tests where sampling_point = 'Boiler Water' and parameter = 'Hardness';
  assert public.water_status(t, 0) = 'ok' and public.water_status(t, 0.5) = 'action', 'hardness 0 ppm';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
do $$
declare tid uuid := (select id from public.water_tests where sampling_point = 'Water from utility' and parameter = 'Total count');
        r public.water_results;
begin
  insert into public.water_results (test_id, sampled_on, value_num) values (tid, current_date - 1, 12) returning * into r;
  assert r.status = 'ok' and r.recorded_by_id = auth.uid(), 'ok result stamped';
  begin
    insert into public.water_results (test_id, sampled_on, value_num) values (tid, current_date - 2, 150);
    raise exception 'out of spec without comment should fail';
  exception when sqlstate 'P0001' then null;
  end;
  insert into public.water_results (test_id, sampled_on, value_num, comment) values (tid, current_date - 2, 150, 'Resampled; tank sanitised');
  begin
    insert into public.instruments (tag, description) values ('PG-X', 'x');
    raise exception 'operator adding instrument should fail';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$
declare i public.instruments;
begin
  insert into public.instruments (tag, description, interval_months, last_calibrated)
  values ('PG-TEST-01', 'Test gauge', 12, current_date - 370) returning * into i;
  assert i.next_due = (current_date - 370 + interval '12 months')::date, 'next due = last + interval';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$ begin
  perform public.run_quality_flags();
  assert exists (select 1 from public.flags where kind = 'water_action'), 'out-of-spec water flagged';
  assert exists (select 1 from public.flags f join public.instruments i on i.id = f.instrument_id
                  where f.kind = 'calibration_due' and i.tag = 'PG-TEST-01'), 'overdue calibration flagged';
end $$;

-- calibrating resolves the flag
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
insert into public.calibrations (instrument_id, calibrated_on, result, certificate_no)
select id, current_date - 1, 'pass', 'CERT-1' from public.instruments where tag = 'PG-TEST-01';
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  assert (select last_calibrated from public.instruments where tag = 'PG-TEST-01') = current_date - 1, 'last calibrated updated';
  perform public.run_quality_flags();
  assert not exists (select 1 from public.flags f join public.instruments i on i.id = f.instrument_id
                      where f.kind = 'calibration_due' and i.tag = 'PG-TEST-01' and f.resolved_at is null), 'calibration resolves flag';
  assert (public.generate_quality_demo('00000000-0000-0000-0000-0000000000b1')->>'water_results')::int > 300, 'demo water results';
end $$;
rollback;
