-- Foundation tests: profiles, roles, audit trail, record stamping.
-- Each test raises an exception on failure. Run via scripts/db-test.sh.
begin;

-- Test users
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test.local', '{"full_name":"Ada Admin"}'),
  ('00000000-0000-0000-0000-00000000000b', 'op@test.local', '{"full_name":"Obi Operator"}');

do $$ begin
  assert (select count(*) from public.profiles) = 2, 'profiles auto-created for new auth users';
  assert (select full_name from public.profiles where email = 'admin@test.local') = 'Ada Admin', 'full_name copied';
  assert (select role from public.profiles where email = 'op@test.local') = 'viewer', 'new users default to viewer';
end $$;

update public.profiles set role = 'admin', active = true where email = 'admin@test.local';
update public.profiles set role = 'operator', active = true where email = 'op@test.local';

-- A scratch table that follows the record-tagging convention.
create table public.t_reading (
  id uuid primary key default gen_random_uuid(),
  value numeric,
  recorded_by_type text not null,
  recorded_by_id uuid,
  recorded_at timestamptz,
  reading_for timestamptz,
  voided_at timestamptz,
  void_reason text
);
create trigger stamp before insert on public.t_reading for each row execute function public.stamp_recorded();
select public.enable_audit('public.t_reading');
grant all on public.t_reading to authenticated;

-- As the operator
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);

do $$
declare r public.t_reading;
begin
  assert public.current_app_role() = 'operator', 'current_app_role works';
  assert not public.is_engineer_or_above(), 'operator is not engineer';

  -- client tries to forge time and identity
  insert into public.t_reading (value, recorded_by_type, recorded_by_id, recorded_at, reading_for)
  values (8.2, 'person', '00000000-0000-0000-0000-00000000000a', '2000-01-01', '2026-10-09 09:00+01')
  returning * into r;
  assert r.recorded_by_id = '00000000-0000-0000-0000-00000000000b', 'recorded_by_id forced to logged-in user';
  assert r.recorded_at > now() - interval '1 minute', 'recorded_at forced to server time';

  -- update without reason is rejected
  begin
    update public.t_reading set value = 9 where id = r.id;
    raise exception 'update without reason should fail';
  exception when sqlstate 'P0001' then
    if sqlerrm not like 'A reason is required%' then raise; end if;
  end;

  -- update with reason is logged
  perform public.set_change_reason('Typo: misread gauge');
  update public.t_reading set value = 8.4 where id = r.id;
  assert (select count(*) from public.audit_log where record_id = r.id::text and action = 'update') = 1, 'update logged';
  assert (select reason from public.audit_log where record_id = r.id::text and action = 'update') = 'Typo: misread gauge', 'reason logged';
  assert (select old_data ->> 'value' from public.audit_log where record_id = r.id::text and action = 'update') = '8.2', 'old value logged';
  assert (select changed_fields from public.audit_log where record_id = r.id::text and action = 'update') = '{value}', 'only changed fields';

  -- delete is blocked
  begin
    delete from public.t_reading where id = r.id;
    raise exception 'delete should fail';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%cannot be deleted%' then raise; end if;
  end;

  -- void with reason
  perform set_config('app.change_reason', '', true);
  update public.t_reading set voided_at = now(), void_reason = 'Entered on wrong register' where id = r.id;
  assert (select count(*) from public.audit_log where record_id = r.id::text and action = 'void') = 1, 'void logged';

  -- operator cannot change roles
  update public.profiles set role = 'admin' where id = auth.uid();
  assert public.current_app_role() = 'operator', 'operator cannot self-promote (RLS)';
end $$;

-- As anonymous: no profile access
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.profiles;
    raise exception 'anon should not read profiles';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
