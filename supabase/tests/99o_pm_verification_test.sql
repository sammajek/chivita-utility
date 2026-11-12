-- PM verification: machine scan needed for monthly+ PM once a scan code exists; spot-checks; early failure flag.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1', 'pvmgr@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', 'pvop@test.local'), ('00000000-0000-0000-0000-0000000000b3', 'pveng@test.local');
update public.profiles set role = 'section_manager', active = true where email = 'pvmgr@test.local';
update public.profiles set role = 'operator', active = true where email = 'pvop@test.local';
update public.profiles set role = 'engineer', active = true where email = 'pveng@test.local';
create temp table t_pv (task uuid, asset uuid, code text, secret text);
grant all on t_pv to authenticated;
insert into t_pv (task, asset, code)
select t.id, a.id, a.code from public.pm_tasks t join public.assets a on a.id = t.asset_id
 where t.frequency = 'monthly' and t.active and a.status <> 'retired' order by t.register_sn limit 1;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
update t_pv set secret = (select code from public.issue_asset_scan_codes(array[(select asset from t_pv)]));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', true);
do $$
declare t uuid := (select task from t_pv); ps date := public.pm_period_start('monthly', public.log_date_of(now())); c uuid;
begin
  begin
    insert into public.pm_completions (task_id, period_start, result, recorded_by_type) values (t, ps, 'done_ok', 'person');
    raise exception 'monthly PM without a scan should fail';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.record_asset_scan((select code from t_pv), 'wrong');
    raise exception 'wrong secret should fail';
  exception when sqlstate 'P0001' then null;
  end;
  perform public.record_asset_scan((select code from t_pv), (select secret from t_pv));
  insert into public.pm_completions (task_id, period_start, result, recorded_by_type) values (t, ps, 'done_ok', 'person') returning id into c;
  assert (select site_verified from public.pm_completions where id = c), 'completion marked verified on site';
end $$;
reset role;
do $$
declare s uuid; c uuid := (select id from public.pm_completions where task_id = (select task from t_pv) and voided_at is null);
begin
  assert public.run_pm_spot_checks() >= 1, 'spot-check picked';
  select id into s from public.pm_spot_checks where completion_id = c;
  assert s is not null, 'our completion was picked (only one this week)';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', true);
set local role authenticated;
do $$
declare s uuid := (select x.id from public.pm_spot_checks x join public.pm_completions c on c.id = x.completion_id where c.task_id = (select task from t_pv));
begin
  begin perform public.check_pm_spot(s, 'not_satisfactory', 'no'); raise exception 'short note should fail';
  exception when sqlstate 'P0001' then null; end;
  perform public.check_pm_spot(s, 'not_satisfactory', 'Filter still dirty, not changed');
  assert not exists (select 1 from public.pm_completions where task_id = (select task from t_pv) and voided_at is null), 'PM reopened';
  assert exists (select 1 from public.flags where ref_key = 'pms:' || s), 'follow-up flag raised';
end $$;
reset role;
do $$
declare t uuid := (select task from t_pv); a uuid := (select asset from t_pv); cat text; fc text; fm text;
begin
  update public.app_settings set value = 'false'::jsonb where key = 'pm_scan_required';   -- the setting switches the scan rule off
  insert into public.pm_completions (task_id, period_start, result, recorded_by_type, recorded_by_id, recorded_at)
  values (t, public.pm_period_start('monthly', public.log_date_of(now())) - 40, 'done_ok', 'person', '00000000-0000-0000-0000-0000000000b2', now() - interval '3 days');
  select c.name into cat from public.assets x join public.asset_categories c on c.id = x.category_id where x.id = a;
  select failure_category, failure_mode into fc, fm from public.downtime_causes
   where downtime_type = 'Unplanned Breakdown' and (equipment_category is null or equipment_category = cat) limit 1;
  insert into public.downtime_events (asset_id, shift, downtime_type, failure_category, failure_mode, start_at, end_at, status, recorded_by_type, recorded_by_id)
  values (a, 'day', 'Unplanned Breakdown', fc, fm, now() + interval '1 minute', null, 'Open', 'person', '00000000-0000-0000-0000-0000000000b2');  -- server stamps the PM at now()
  perform public.run_pm_verification_flags();
  assert exists (select 1 from public.flags where kind = 'pm_early_failure' and asset_id = a), 'early failure flagged';
end $$;
rollback;
