-- Control-room code: verifies presence, checks in if needed, old code stops working after reissue.
begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b7', 'presmgr@test.local'),
                                          ('00000000-0000-0000-0000-0000000000b8', 'presop@test.local');
update public.profiles set role = 'section_manager', active = true where email = 'presmgr@test.local';
update public.profiles set role = 'operator', active = true where email = 'presop@test.local';
create temp table t_c (k text);
grant all on t_c to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b7', true);
insert into t_c select public.issue_checkin_code('U1');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b8', true);
do $$
declare r public.duty_sessions;
begin
  begin
    perform public.issue_checkin_code('U1');
    raise exception 'operator cannot issue codes';
  exception when sqlstate 'P0001' then null;
  end;
  begin
    perform public.verify_presence('U1', 'wrong');
    raise exception 'wrong code should fail';
  exception when sqlstate 'P0001' then null;
  end;
  r := public.verify_presence('U1', (select k from t_c));
  assert r.presence_verified_at is not null and r.presence_area = 'U1' and 'U1' = any (r.areas), 'checked in and verified';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b7', true);
select public.issue_checkin_code('U1');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b8', true);
do $$
begin
  perform public.verify_presence('U1', (select k from t_c));
  raise exception 'old code should stop working';
exception when sqlstate 'P0001' then null;
end $$;
rollback;
