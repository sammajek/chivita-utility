-- Engineer KPIs: weekly log permissions, auto KPIs from duty shifts.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e9', 'kpieng@test.local'),
                                          ('00000000-0000-0000-0000-0000000000ea', 'kpiother@test.local');
update public.profiles set role = 'engineer', active = true, areas = '{U1}' where email in ('kpieng@test.local', 'kpiother@test.local');
update public.staff set profile_id = '00000000-0000-0000-0000-0000000000e9' where staff_id = '11104472';
create temp table t_k (k text, v uuid);
grant all on t_k to authenticated;
insert into t_k values ('staff', (select id from public.staff where staff_id = '11104472'));
do $$ begin assert (select count(*) from public.kpi_definitions) = 11, '11 KPIs'; end $$;

-- a day shift yesterday with readings and a 3-hour breakdown
insert into public.duty_sessions (profile_id, shift_date, shift, areas, checked_in_at, checked_out_at, handover_note)
values ('00000000-0000-0000-0000-0000000000e9', public.lagos_now()::date - 1, 'day', '{U1}',
        public.lagos_ts(public.lagos_now()::date - 1, time '07:05'), public.lagos_ts(public.lagos_now()::date - 1, time '19:00'), 'ok');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e9', true);
do $$
declare st uuid := (select v from t_k where k = 'staff');
        wk date := (public.lagos_now()::date - extract(isodow from public.lagos_now()::date)::int + 1);
begin
  insert into public.engineer_weekly_logs (staff_ref, week_start, gemba_raised, gemba_closed) values (st, wk, 10, 9);
  begin
    insert into public.engineer_weekly_logs (staff_ref, week_start, gemba_raised, gemba_closed) values (st, wk - 7, 3, 5);
    raise exception 'closed > raised should fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.engineer_weekly_logs (staff_ref, week_start) values (st, wk + 1);
    raise exception 'week must start on Monday';
  exception when check_violation then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ea', true);
do $$
begin
  insert into public.engineer_weekly_logs (staff_ref, week_start) values ((select v from t_k where k = 'staff'), date '2026-01-05');
  raise exception 'another engineer cannot write my log';
exception when insufficient_privilege then null;
end $$;

reset role;
do $$
declare m date := date_trunc('month', public.lagos_now()::date - 1)::date; a record;
begin
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status,
                                      recorded_by_type, recorded_by_id, recorded_at, is_demo)
  values ((select id from public.assets where code = 'CMP-05'), 'day', 'Unplanned Breakdown', 'Mechanical',
          (select value from public.lists where list_name = 'failure_mode' and parent = 'Mechanical' limit 1),
          public.lagos_ts(public.lagos_now()::date - 1, time '09:00'), public.lagos_ts(public.lagos_now()::date - 1, time '12:00'),
          'Closed', 'person', '00000000-0000-0000-0000-0000000000e9', now(), true);
  select * into a from public.engineer_kpi_auto('00000000-0000-0000-0000-0000000000e9', extract(year from m)::int)
   where month = m and kpi = 'availability';
  assert a.den = 12 * (select count(*) from public.assets where area = 'U1' and status <> 'retired'), 'equipment-hours on my shift';
  assert a.den - a.num = 3, 'three breakdown hours deducted';
end $$;
rollback;
