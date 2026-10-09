-- Demo data generator and cleanup.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'demo.op@test.local'),
  ('00000000-0000-0000-0000-0000000000e2', 'demo.eng@test.local');
update public.profiles set role = 'operator', active = true where email = 'demo.op@test.local';
update public.profiles set role = 'engineer', active = true where email = 'demo.eng@test.local';
do $$
declare res jsonb;
begin
  res := public.generate_demo_data(3, '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
  assert (res ->> 'readings')::int > 1000, 'readings generated: ' || res::text;
  assert exists (select 1 from public.readings where is_demo and status = 'out_of_spec' and comment like 'DEMO%'), 'some out of spec with comment';
  assert not exists (select 1 from public.readings where is_demo and status = 'out_of_spec' and comment is null), 'every out-of-spec has comment';
  assert exists (select 1 from public.downtime_events where is_demo and status = 'Awaiting Spares'), 'open downtime';
  assert (select count(*) from public.readings where is_demo and recorded_by_id = '00000000-0000-0000-0000-0000000000e1') = (res ->> 'readings')::int, 'tagged to demo operator';
  perform public.clear_demo_data();
  assert not exists (select 1 from public.readings where is_demo), 'demo readings cleared';
  assert not exists (select 1 from public.downtime_events where is_demo), 'demo downtime cleared';
end $$;
-- signed-in users cannot create demo rows (which keep their own timestamps)
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
do $$ begin
  begin
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num, recorded_at, is_demo)
    select f.id, (select id from public.assets where code = 'BLR-01'), current_date, '09:00', now(), 8.2, '2020-01-01', true
      from public.register_fields f join public.register_sections s on s.id = f.section_id
      join public.registers r on r.id = s.register_id where r.key = 'u1-boiler' and f.label like 'Steam Pressure%';
    raise exception 'user demo insert should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
