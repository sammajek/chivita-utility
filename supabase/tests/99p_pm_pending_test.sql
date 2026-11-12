-- PM Pending: needs a date; completing it later keeps the pending entry (voided) and records the result; overdue flag.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'pmop@test.local');
update public.profiles set role = 'operator', active = true where email = 'pmop@test.local';
create temp table t_pm (task uuid, c uuid);
grant all on t_pm to authenticated;
insert into t_pm (task) select id from public.pm_tasks where frequency = 'weekly' and active order by register_sn limit 1;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a9', true);
do $$
declare t uuid := (select task from t_pm); ps date := public.pm_period_start('weekly', public.log_date_of(now())); c uuid; f uuid;
begin
  begin
    insert into public.pm_completions (task_id, period_start, result, recorded_by_type) values (t, ps, 'pending', 'person');
    raise exception 'pending without a date should fail';
  exception when check_violation then null;
  end;
  insert into public.pm_completions (task_id, period_start, result, pending_until, note, recorded_by_type)
  values (t, ps, 'pending', ps + 3, 'Awaiting spare filter', 'person') returning id into c;
  update t_pm set c = (select id from public.pm_completions where task_id = t and period_start = ps and voided_at is null);
  begin
    perform public.resolve_pending_pm(c, 'not_done', null);
    raise exception 'skipped without a note should fail';
  exception when sqlstate 'P0001' then null;
  end;
  f := public.resolve_pending_pm(c, 'done_ok', null);
  assert (select result from public.pm_completions where id = f) = 'done_ok', 'final result recorded';
  assert (select voided_at is not null and void_reason = 'Completed after pending' from public.pm_completions where id = c), 'pending entry kept, voided';
end $$;
reset role;
do $$
declare t uuid := (select task from t_pm); ps date := public.pm_period_start('weekly', public.log_date_of(now())) - 14; c uuid;
begin
  insert into public.pm_completions (task_id, period_start, result, pending_until, recorded_by_type, recorded_by_id)
  values (t, ps, 'pending', ps + 1, 'person', '00000000-0000-0000-0000-0000000000a9') returning id into c;
  perform public.run_pm_flags();
  assert exists (select 1 from public.flags where ref_key = 'pmp:' || c and kind = 'pm_overdue'), 'pending past its date is flagged';
end $$;
rollback;
