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

-- leakage from register leak checks: Leak → Leak → No Leak (closed within 24 h) counts as one leak, closed
do $$
declare m date := date_trunc('month', public.lagos_now()::date - 1)::date; l record; f record; sl record; n int := 0;
begin
  select rf.id as field_id, rf.section_id, coalesce(rf.asset_id, ra.asset_id) as asset_id into f
    from public.register_fields rf join public.parameters p on p.id = rf.parameter_id
    join public.register_sections s on s.id = rf.section_id join public.registers g on g.id = s.register_id and g.area = 'U1'
    left join public.register_assets ra on ra.register_id = g.id and rf.asset_id is null
   where 'Leak' = any (p.options) and rf.active
     and exists (select 1 from public.register_slots(public.lagos_now()::date - 1) x where x.section_id = rf.section_id
                  and x.due_at >= public.lagos_ts(public.lagos_now()::date - 1, time '07:00')
                  and x.due_at < public.lagos_ts(public.lagos_now()::date - 1, time '19:00'))
   order by (select count(*) from public.register_slots(public.lagos_now()::date - 1) x where x.section_id = rf.section_id) desc
   limit 1;
  assert f.field_id is not null, 'a U1 leak check found';
  for sl in select x.slot_key, x.due_at from public.register_slots(public.lagos_now()::date - 1) x
             where x.section_id = f.section_id and x.due_at >= public.lagos_ts(public.lagos_now()::date - 1, time '07:00')
             order by x.due_at limit 3 loop
    n := n + 1;
    insert into public.readings (field_id, asset_id, log_date, slot_key, reading_for, value_text, comment,
                                 recorded_by_type, recorded_by_id, recorded_at, is_demo)
    values (f.field_id, f.asset_id, public.lagos_now()::date - 1, sl.slot_key, sl.due_at,
            case when n < 3 then 'Leak' else 'No Leak' end, 'test leak', 'person', '00000000-0000-0000-0000-0000000000e9', now(), true);
  end loop;
  select * into l from public.engineer_kpi_auto('00000000-0000-0000-0000-0000000000e9', extract(year from m)::int)
   where month = m and kpi = 'leakage';
  assert l.den = 1, 'consecutive Leak answers are one leak';
  assert l.num = case when n = 3 then 1 else 0 end, 'closed when No Leak follows within 24 h';
end $$;
rollback;

-- PM % starts from the first PM result when no go-live date is set
begin;
do $$
begin
  update public.app_settings set value = 'null'::jsonb where key = 'pm_monitor_from';
  assert public.pm_kpi_start() = coalesce((select min(period_start) from public.pm_completions where voided_at is null), 'infinity'::date), 'first PM result';
  update public.app_settings set value = '"2026-09-01"'::jsonb where key = 'pm_monitor_from';
  assert public.pm_kpi_start() = '2026-09-01', 'go-live date wins';
end $$;
rollback;
