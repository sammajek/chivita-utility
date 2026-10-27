-- Outage: no missing flags while open / during back-entry; paper readings linked to the outage.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'outeng@test.local');
update public.profiles set role = 'engineer', active = true where email = 'outeng@test.local';
update public.registers set monitor = (key = 'u1-boiler');
update public.app_settings set value = 'null'::jsonb where key = 'reading_monitor_from';

create temp table t_o (id uuid);
grant all on t_o to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare o uuid;
begin
  o := public.declare_outage('Internet down at Utility 1', now() - interval '30 hours');
  begin
    perform public.declare_outage('again', now());
    raise exception 'second open outage should fail';
  exception when sqlstate 'P0001' then null;
  end;
  insert into t_o values (o);
end $$;

reset role;
do $$
begin
  perform public.run_reading_flags();
  assert not exists (select 1 from public.flags where kind = 'reading_missing'), 'no missing flags during an open outage';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
do $$
declare s record; r public.readings;
begin
  select rs.section_id, rs.slot_key, rs.due_at, d::date as log_date into s
    from generate_series(public.log_date_of(now()) - 1, public.log_date_of(now()), interval '1 day') d,
         lateral public.register_slots(d::date) rs
    join public.registers g on g.id = rs.register_id and g.key = 'u1-boiler'
   where rs.due_at < now() - interval '2 hours' order by rs.due_at desc limit 1;
  insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_num, entry_method)
  select f.id, (select asset_id from public.register_assets ra join public.register_sections x on x.register_id = ra.register_id where x.id = s.section_id limit 1),
         s.log_date, s.slot_key, s.due_at, 8.2, 'paper'
    from public.register_fields f where f.section_id = s.section_id and f.label like 'Steam Pressure%' limit 1
  returning * into r;
  assert r.entry_method = 'paper' and r.outage_id = (select id from t_o), 'paper reading linked to outage';
  perform public.end_outage((select id from t_o), now() - interval '1 hour', 'Back online');
end $$;

reset role;
do $$
begin
  perform public.run_reading_flags();
  assert not exists (select 1 from public.flags where kind = 'reading_missing'), 'back-entry window: still no flags';
  update public.system_outages set ended_at = now() - interval '25 hours', started_at = now() - interval '50 hours';
  perform public.run_reading_flags();
  assert exists (select 1 from public.flags where kind = 'reading_missing'), 'after the window, empty slots are flagged';
end $$;
rollback;
