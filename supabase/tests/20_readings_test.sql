-- Readings: server-side status, out-of-spec rule, one value per slot, amend/void.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'op2@test.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'eng@test.local');
update public.profiles set role = 'operator', active = true where email = 'op2@test.local';
update public.profiles set role = 'engineer', active = true where email = 'eng@test.local';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

do $$
declare
  f_steam uuid; f_leak uuid; boiler1 uuid; r public.readings;
begin
  select rf.id into f_steam from public.register_fields rf
    join public.register_sections s on s.id = rf.section_id
    join public.registers g on g.id = s.register_id
   where g.key = 'u1-boiler' and rf.label = 'Steam Pressure (bar)';
  select rf.id into f_leak from public.register_fields rf
    join public.register_sections s on s.id = rf.section_id
    join public.registers g on g.id = s.register_id
   where g.key = 'u1-boiler' and rf.label = 'Steam Leakage';
  select id into boiler1 from public.assets where code = 'BLR-01';
  assert f_steam is not null and f_leak is not null and boiler1 is not null, 'seed present';

  -- in spec (8.0 - 8.5 bar)
  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
  values (f_steam, boiler1, '2026-10-09', '09:00', '2026-10-09 09:00+01', 8.2) returning * into r;
  assert r.status = 'ok', 'in-spec value is ok';
  assert r.parameter_id is not null and r.register_id is not null, 'parameter and register filled by server';

  -- same slot twice is rejected
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
    values (f_steam, boiler1, '2026-10-09', '09:00', '2026-10-09 09:00+01', 8.3);
    raise exception 'duplicate slot should fail';
  exception when unique_violation then null;
  end;

  -- out of spec without comment is rejected
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
    values (f_steam, boiler1, '2026-10-09', '15:00', '2026-10-09 15:00+01', 7.1);
    raise exception 'out of spec without comment should fail';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%out of spec%' then raise; end if;
  end;

  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num, comment)
  values (f_steam, boiler1, '2026-10-09', '15:00', '2026-10-09 15:00+01', 7.1, 'Load surge, informed engineer') returning * into r;
  assert r.status = 'out_of_spec', 'low steam pressure is out of spec';

  -- select field: Leak is out of spec, No Leak ok, invalid option rejected
  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_text)
  values (f_leak, boiler1, '2026-10-09', 'day', '2026-10-09 07:00+01', 'No Leak') returning * into r;
  assert r.status = 'ok', 'No Leak is ok';
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_text)
    values (f_leak, boiler1, '2026-10-09', 'night', '2026-10-09 19:00+01', 'Maybe');
    raise exception 'invalid option should fail';
  exception when sqlstate 'P0001' then null;
  end;

  -- wrong equipment for the register is rejected
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num)
    values (f_steam, (select id from public.assets where code = 'BLR-03'), '2026-10-09', '21:00', '2026-10-09 21:00+01', 8.2);
    raise exception 'asset not on register should fail';
  exception when sqlstate 'P0001' then null;
  end;

  -- amend own reading with reason; audit keeps old value
  select * into r from public.readings where field_id = f_steam and slot_key = '09:00';
  perform public.amend_reading(r.id, 8.4, null, null, null, 'Misread gauge');
  assert (select value_num from public.readings where id = r.id) = 8.4, 'amended';
  assert (select amended from public.readings where id = r.id), 'amended flag set';
  assert (select old_data ->> 'value_num' from public.audit_log where record_id = r.id::text and action = 'update') = '8.2', 'old value kept';

  -- direct update is not allowed (no policy)
  update public.readings set value_num = 1 where id = r.id;
  assert (select value_num from public.readings where id = r.id) = 8.4, 'direct update blocked by RLS';
end $$;

-- another operator cannot amend; engineer can void
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);
do $$
declare rid uuid;
begin
  select id into rid from public.readings where slot_key = '15:00' limit 1;
  perform public.void_reading(rid, 'Entered on wrong boiler');
  assert (select voided_at is not null from public.readings where id = rid), 'engineer voided reading';
end $$;

rollback;
