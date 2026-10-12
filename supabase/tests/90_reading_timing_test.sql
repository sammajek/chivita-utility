-- Slot timing: missing after 60 min (per machine), early entries flagged, machines under downtime not expected,
-- reading_for set by the server, go-live cut-off.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'timing@test.local');
update public.profiles set role = 'operator', active = true where email = 'timing@test.local';
update public.registers set monitor = (key = 'u1-compressor-oilfree');

create temp table t_ctx as
select rs.section_id, rs.slot_key, rs.due_at, d::date as log_date
  from generate_series(public.log_date_of(now()) - 1, public.log_date_of(now()), interval '1 day') d,
       lateral public.register_slots(d::date) rs
  join public.registers r on r.id = rs.register_id and r.key = 'u1-compressor-oilfree'
  join public.register_sections s on s.id = rs.section_id and s.slot_kind = 'time'
 where rs.due_at between now() - interval '20 hours' and now() - interval '70 minutes'
 order by rs.due_at desc limit 1;
grant select on t_ctx to authenticated;

do $$
declare c t_ctx; n int; codes text;
begin
  select * into c from t_ctx;
  assert c.section_id is not null, 'found a past compressor slot';
  assert public.setting_num('reading_missing_after_min', 0) = 60, 'missing after 60 min';
  assert (select count(*) from public.registers where monitor) = 1, 'test setup';

  -- go-live cut-off: slots before reading_monitor_from are not flagged
  update public.app_settings set value = to_jsonb(now()) where key = 'reading_monitor_from';
  perform public.run_reading_flags();
  assert not exists (select 1 from public.flags where kind = 'reading_missing'), 'nothing flagged before go-live';

  update public.app_settings set value = 'null'::jsonb where key = 'reading_monitor_from';
  -- one compressor is down for planned maintenance over the slot → not expected
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status,
                                      recorded_by_type, recorded_by_id, recorded_at, is_demo)
  values ((select id from public.assets where code = 'CMP-05'), 'day', 'Planned Maintenance', 'Planned Maintenance',
          'Planned preventive maintenance', c.due_at - interval '1 hour', c.due_at + interval '1 hour', 'Closed',
          'person', '00000000-0000-0000-0000-0000000000c1', now(), true);
  perform public.run_reading_flags();
  select detail into codes from public.flags where kind = 'reading_missing' and section_id = c.section_id and slot_key = c.slot_key and log_date = c.log_date;
  assert codes is not null, 'slot flagged after 60 min';
  assert codes like '%CMP-03%' and codes not like '%CMP-05%', 'machine under downtime is not expected';
end $$;

-- readings for every expected machine, entered late, resolve the flag; reading_for comes from the slot
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
declare c t_ctx; r public.readings;
begin
  select * into c from t_ctx;
  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num, value_text)
  select f.id, ea.asset_id, c.log_date, c.slot_key, now() + interval '9 hours',  -- phone time ignored
         case when p.data_type = 'number' then coalesce(p.std_min, p.std_max, 1) end,
         case when p.data_type = 'select' then coalesce(p.ok_options[1], p.options[1]) end
    from public.register_fields f join public.parameters p on p.id = f.parameter_id
    cross join public.slot_expected_assets(c.section_id, c.due_at) ea
   where f.section_id = c.section_id and f.active and f.asset_id is null
     and p.data_type <> 'text';
  select * into r from public.readings where log_date = c.log_date and slot_key = c.slot_key order by recorded_at desc limit 1;
  assert r.reading_for = c.due_at, 'reading_for set from the slot, not the phone';
  assert r.minutes_late >= 70 and r.minutes_early = 0, 'late entry measured';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare c t_ctx;
begin
  select * into c from t_ctx;
  perform public.run_reading_flags();
  assert (select resolved_at is not null from public.flags where kind = 'reading_missing' and section_id = c.section_id
            and slot_key = c.slot_key and log_date = c.log_date), 'late readings resolve the missing flag';
end $$;

-- EARLY: entering a slot that opens in the future is flagged; more than a day ahead is refused
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
do $$
declare sec uuid; slot text; ld date; due timestamptz; fld uuid; r public.readings;
begin
  select rs.section_id, rs.slot_key, d::date, rs.due_at into sec, slot, ld, due
    from generate_series(public.log_date_of(now()), public.log_date_of(now()) + 1, interval '1 day') d,
         lateral public.register_slots(d::date) rs
    join public.registers rg on rg.id = rs.register_id and rg.key = 'u1-compressor-oilfree'
    join public.register_sections s on s.id = rs.section_id and s.slot_kind = 'time'
   where rs.due_at between now() + interval '2 hours' and now() + interval '20 hours'
   order by rs.due_at limit 1;
  select f.id into fld from public.register_fields f join public.parameters p on p.id = f.parameter_id
   where f.section_id = sec and f.active and p.data_type = 'number' limit 1;
  insert into public.readings (field_id, asset_id, log_date, slot_key, value_num, comment)
  values (fld, (select id from public.assets where code = 'CMP-03'), ld, slot, 5, 'test') returning * into r;
  assert r.minutes_early >= 100, 'early minutes recorded';
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, value_num)
    values (fld, (select id from public.assets where code = 'CMP-04'), ld + 3, slot, 5);
    raise exception 'three days ahead should be refused';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%more than a day away%' then raise; end if;
  end;
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, value_num)
    values (fld, (select id from public.assets where code = 'CMP-04'), ld, '99:99', 5);
    raise exception 'unknown slot should be refused';
  exception when sqlstate 'P0001' or invalid_datetime_format or datetime_field_overflow then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform public.run_reading_flags();
  assert exists (select 1 from public.flags f join public.assets a on a.id = f.asset_id
                  where f.kind = 'reading_early' and a.code = 'CMP-03'), 'early entry flagged';
end $$;
rollback;
