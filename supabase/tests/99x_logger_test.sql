-- Logger import: key check, slot placement, meter 07:00 reading, raw storage, rejects.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'logadmin@test.local');
update public.profiles set role = 'admin', active = true where email = 'logadmin@test.local';
create temp table t_key (k text);
grant all on t_key to authenticated, anon;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
insert into t_key select public.issue_logger_key('U1 energy gateway', 'test', 'U1');
reset role;

do $$
declare k text := (select k from t_key); res jsonb; sl record; d date := public.lagos_now()::date - 1; mid uuid;
begin
  assert k like 'chi_%' and length(k) = 68, 'key format';
  assert (select api_key_hash from public.loggers where name = 'U1 energy gateway') <> k, 'only the hash is stored';
  begin
    perform public.logger_ingest('wrong', '[]');
    raise exception 'wrong key should fail';
  exception when sqlstate '28000' then null;
  end;

  -- a compressor running-hours value 5 minutes after a slot of yesterday
  select x.due_at into sl from public.register_fields rf join public.parameters p on p.id = rf.parameter_id
    join public.register_sections s on s.id = rf.section_id join public.register_assets ra on ra.register_id = s.register_id
    cross join lateral public.register_slots(d) x
   where p.name = 'Running Hours' and ra.asset_id = (select id from public.assets where code = 'CMP-03') and x.section_id = s.id
   order by x.due_at limit 1;
  select id into mid from public.meters where code = 'E-C3';
  res := public.logger_ingest(k, jsonb_build_array(
    jsonb_build_object('asset_code', 'CMP-03', 'parameter', 'running hours', 'value', '4321', 'timestamp', sl.due_at + interval '5 minutes'),
    jsonb_build_object('asset_code', 'CMP-03', 'parameter', 'Running Hours', 'value', '4322', 'timestamp', sl.due_at + interval '40 minutes'),
    jsonb_build_object('meter_code', 'E-C3', 'value', '120000', 'timestamp', public.lagos_ts(d, time '07:02')),
    jsonb_build_object('asset_code', 'NOPE-99', 'parameter', 'x', 'value', '1', 'timestamp', now()),
    jsonb_build_object('meter_code', 'E-C3', 'value', '1', 'timestamp', now() + interval '2 days')));
  assert (res->>'register_slots')::int = 1, 'value near a slot fills it: ' || res;
  assert (res->>'meter_readings')::int = 1, 'meter value near 07:00 becomes the day''s reading';
  assert (res->>'stored_only')::int = 1, 'value between slots kept as raw data only';
  assert (res->>'rejected')::int = 2, 'unknown equipment and future time rejected';
  assert (select count(*) from public.logger_data) = 5, 'every row kept';
  assert exists (select 1 from public.readings r where r.recorded_by_type = 'logger' and r.entry_method = 'logger'
                  and r.value_num = 4321 and r.minutes_late = 0), 'reading tagged to the logger, not late';
  assert (select value from public.meter_readings where meter_id = mid and read_date = d) = 120000, 'meter reading';
  assert (select last_seen_at from public.loggers where name = 'U1 energy gateway') is not null, 'last seen';
end $$;
rollback;
