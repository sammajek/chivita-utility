-- Follow-up KPI, worked example: two downtime further actions due yesterday in Utility 1;
-- one completed on time, one still open → Follow-ups Closed on Time = 1 ÷ 2 = 50 %, and one open (overdue) follow-up listed.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f7', 'fukpi@test.local');
update public.profiles set role = 'engineer', active = true, areas = '{U1}' where email = 'fukpi@test.local';
create temp table t_f (k text primary key, id uuid);
grant all on t_f to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f7', true);
do $$
declare e uuid; f uuid; due date := public.lagos_now()::date - 1;
begin
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, status, attended_by)
  values ((select id from public.assets where code = 'CMP-04'), 'day', 'Unplanned Breakdown', 'Mechanical',
          (select value from public.lists where list_name = 'failure_mode' and parent = 'Mechanical' limit 1),
          now() - interval '3 days', 'Open', 'Utility Section (In-house)')
  returning id into e;
  insert into public.downtime_followups (downtime_id, stage, note, action_owner, target_date)
  values (e, 'further_action', 'Replace valve', 'E&I Section', due) returning id into f;
  insert into t_f values ('done', f);
  insert into public.downtime_followups (downtime_id, stage, note, action_owner, target_date)
  values (e, 'further_action', 'Order spare seal kit', 'Stores', due);
end $$;

reset role;
select public.set_change_reason('test: action completed');
update public.downtime_followups set completed_at = now() - interval '2 days' where id = (select id from t_f where k = 'done');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f7', true);
do $$
declare n numeric; d numeric; due date := public.lagos_now()::date - 1;
begin
  assert exists (select 1 from public.kpi_definitions where code = 'followup'), 'followup KPI defined';
  assert (select count(*) from public.kpi_definitions where shift_based) = 5, 'five shift-based KPIs';
  select num, den into n, d from public.engineer_kpi_auto('00000000-0000-0000-0000-0000000000f7', extract(year from due)::int)
   where kpi = 'followup' and month = date_trunc('month', due)::date;
  assert n = 1 and d = 2, format('expected 1 of 2 on time, got %s of %s', n, d);
  assert (select count(*) from public.open_followups() where kind = 'downtime' and overdue and title = 'Order spare seal kit') = 1, 'open overdue item listed';
  assert not exists (select 1 from public.open_followups() where title = 'Replace valve'), 'completed item not listed';
  -- dashboard: same example over the last 7 days in Utility 1
  select fu_on_time, fu_due into n, d from public.maintenance_kpis(due - 6, due + 1, '{U1}');
  assert n = 1 and d = 2, format('dashboard: expected 1 of 2, got %s of %s', n, d);
  assert (select fu_open = 1 and fu_overdue = 1 from public.maintenance_kpis(due - 6, due + 1, '{U1}')), 'dashboard open/overdue';
  assert (select fu_due = 0 from public.maintenance_kpis(due - 6, due + 1, '{U2}')), 'Utility 2 has none';
end $$;
rollback;
