-- AMC planning/visits/past-due flags and the cleaning roster.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'clop@test.local'),
  ('00000000-0000-0000-0000-0000000000f2', 'cleng@test.local'),
  ('00000000-0000-0000-0000-0000000000f3', 'clmgr@test.local');
update public.profiles set role = 'operator', active = true where email = 'clop@test.local';
update public.profiles set role = 'engineer', active = true where email = 'cleng@test.local';
update public.profiles set role = 'section_manager', active = true where email = 'clmgr@test.local';

do $$ begin
  assert (select count(*) from public.amc_contracts) = 4, '4 AMC contracts seeded';
  assert (select count(*) from public.cleaning_zones) = 5 and (select count(*) from public.cleaning_activities) = 3, 'roster seeded';
end $$;

set local role authenticated;
-- operator cannot plan AMC
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
do $$ begin
  begin
    perform public.set_amc_plan((select id from public.amc_contracts where sn = 1), date_trunc('month', now())::date, true);
    raise exception 'operator planning should fail';
  exception when sqlstate 'P0001' then null;
  end;
end $$;

-- engineer plans last month and two months ago; records a visit for one
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
do $$
declare c uuid := (select id from public.amc_contracts where sn = 1);
        m1 date := (date_trunc('month', public.lagos_now()) - interval '1 month')::date;
        m2 date := (date_trunc('month', public.lagos_now()) - interval '2 months')::date;
        v public.amc_visits;
begin
  perform public.set_amc_plan(c, m1, true);
  perform public.set_amc_plan(c, m2, true);
  insert into public.amc_visits (contract_id, month, visit_date, vendor_rep, findings)
  values (c, m2, m2 + 5, 'J. Okafor', 'Condenser cleaned') returning * into v;
  assert v.recorded_by_id = auth.uid() and v.month = m2, 'visit stamped';
  begin
    insert into public.amc_visits (contract_id, month, visit_date) values (c, m1, public.lagos_now()::date + 40);
    raise exception 'future visit should fail';
  exception when sqlstate 'P0001' or check_violation then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$
declare n int;
begin
  n := public.run_amc_flags();
  assert n = 1, 'one past-due month flagged (the month without a visit)';
  perform public.run_amc_flags();
  assert (select count(*) from public.flags where kind = 'amc_past_due') = 1, 'idempotent';
end $$;

-- unplanning the month resolves the flag
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f2', true);
select public.set_amc_plan((select id from public.amc_contracts where sn = 1),
                           (date_trunc('month', public.lagos_now()) - interval '1 month')::date, false);
reset role;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
  perform public.run_amc_flags();
  assert not exists (select 1 from public.flags where kind = 'amc_past_due' and resolved_at is null), 'unplanned month resolves flag';
end $$;

-- cleaning: operator records, manager signs off, then the week is locked
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
do $$
declare wk date := public.pm_period_start('weekly', public.log_date_of(now())) - 7; c public.cleaning_checks;
begin
  insert into public.cleaning_checks (week_start, zone_id, activity_id, result) values (wk + 3, 1, 1, 'done') returning * into c;
  assert c.week_start = wk, 'week snapped to Sunday';
  begin
    insert into public.cleaning_checks (week_start, zone_id, activity_id, result) values (wk, 1, 2, 'not_done');
    raise exception 'not done without note should fail';
  exception when check_violation then null;
  end;
  begin
    insert into public.cleaning_signoffs (week_start) values (wk);
    raise exception 'operator sign-off should fail';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f3', true);
insert into public.cleaning_signoffs (week_start, comment) values (public.pm_period_start('weekly', public.log_date_of(now())) - 7, 'OK');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f1', true);
do $$ begin
  begin
    insert into public.cleaning_checks (week_start, zone_id, activity_id, result)
    values (public.pm_period_start('weekly', public.log_date_of(now())) - 7, 2, 1, 'done');
    raise exception 'signed-off week should be locked';
  exception when sqlstate 'P0001' then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', true);

do $$ declare r jsonb;
begin
  r := public.generate_amc_cleaning_demo('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3');
  assert (r->>'planned')::int > 30, 'demo AMC plan';
  assert exists (select 1 from public.cleaning_checks where is_demo), 'demo cleaning';
end $$;
rollback;
