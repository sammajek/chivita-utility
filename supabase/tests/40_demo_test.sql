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
rollback;
